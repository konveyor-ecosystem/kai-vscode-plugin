import * as vscode from 'vscode';
import fetch from 'node-fetch';
import * as path from 'path';
import { FileNode } from '../tree/fileNode';

export interface Requests {
    id: number;
    name: string;
    type: 'kai' | 'kantra';
    file: string; 
    data: any;
}

let taskcounter = 0;
let requests: Requests[] = [];
const fileProcessMap: Map<string, { inProgress: boolean, taskExecution?: vscode.TaskExecution }> = new Map(); 

export const runningTasks = new Map<number, { taskExecution: vscode.TaskExecution, workerType: 'kai' | 'kantra' }>();

export function getTaskCounter() {
    return taskcounter;
}

export function incrementTaskCounter() {
    return ++taskcounter;
}

export function getRequests() {
    return requests;
}

export function addRequest(request: Requests) {
    // Check if there a process running on the file
    if (fileProcessMap.get(request.file)?.inProgress) {
        console.log(`A process is running on the file ${request.file}`);
        vscode.window.showErrorMessage(`A process is running on the file ${request.file}`);
        return;
    }
    requests.push(request);
    console.log(`Task added to queue: ${JSON.stringify(request)}`);
}

export class ProcessController {
    private maxKaiWorkers: number;
    private maxKantraWorkers: number;
    private activeKaiTasks: Set<number>;
    private activeKantraTasks: Set<number>;
    private outputChannel: vscode.OutputChannel;
    private kaiFixDetails: any;

    constructor(maxKaiWorkers: number, maxKantraWorkers: number, outputChannel: vscode.OutputChannel, kaiFixDetails: any) {
        this.maxKaiWorkers = maxKaiWorkers;
        this.maxKantraWorkers = maxKantraWorkers;
        this.activeKaiTasks = new Set();
        this.activeKantraTasks = new Set();
        this.outputChannel = outputChannel;
        this.kaiFixDetails = kaiFixDetails;
        this.pollQueue();
    }

    private async pollQueue() {
        while (true) {
            await this.processQueue();
            await this.sleep(1000); 
        }
    }

    private sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async processQueue() {
        for (const task of requests) {
            if (task.type === "kai" && this.activeKaiTasks.size < this.maxKaiWorkers) {
                if (this.isFileInProgress(task.file)) continue; // Skip if file is already in progress
                this.activeKaiTasks.add(task.id);
                this.updateFileState(task.file, { inProgress: true, taskExecution: undefined });
                this.startTask(task);
                requests = requests.filter(req => req.id !== task.id);
            } else if (task.type === "kantra" && this.activeKantraTasks.size < this.maxKantraWorkers) {
                if (this.isFileInProgress(task.file)) continue; // Skip if file is already in progress
                this.activeKantraTasks.add(task.id);
                this.updateFileState(task.file, { inProgress: true, taskExecution: undefined });
                this.startTask(task);
                requests = requests.filter(req => req.id !== task.id);
            }
        }
    }

    private isFileInProgress(filePath: string): boolean {
        return fileProcessMap.get(filePath)?.inProgress || false;
    }

    private updateFileState(filePath: string, state: { inProgress: boolean, taskExecution?: vscode.TaskExecution }) {
        const currentState = fileProcessMap.get(filePath) || {};
        fileProcessMap.set(filePath, { ...currentState, ...state });
    }
    async startTask(request: Requests) {
        const task = new vscode.Task(
            { type: 'mytask', task: request.name, requestType: request.type, id: request.id },  
            vscode.TaskScope.Workspace,
            request.name,
            'myTaskProvider',
            new vscode.CustomExecution(async (): Promise<vscode.Pseudoterminal> => {
                return new SimplePseudoterminal(request, this.outputChannel, this);
            })
        );
    
        const execution = await vscode.tasks.executeTask(task);
        runningTasks.set(request.id, { taskExecution: execution, workerType: request.type });
        this.updateFileState(request.file, { inProgress: true, taskExecution: execution }); 
    }
    

    async completeTask(request: Requests, result: any) {
        if (request.type === "kai") {
            this.activeKaiTasks.delete(request.id);
        } else if (request.type === "kantra") {
            this.activeKantraTasks.delete(request.id);
        }
        runningTasks.delete(request.id);
        this.updateFileState(request.file, { inProgress: false, taskExecution: undefined }); 
        // this.outputChannel.appendLine(`Completed task: ${JSON.stringify(request)}`);
        // Send result back to KaiFixDetails
        this.kaiFixDetails.handleTaskResult(request.file, result, request.type); 
        this.processQueue(); 
    }

    async stopTask(filePath: string) {
        const normalizedPath = path.normalize(filePath);
        const state = fileProcessMap.get(normalizedPath);
        this.outputChannel.appendLine(`Stop requested for file: ${normalizedPath}`);
    
        if (state && state.taskExecution) {
            this.outputChannel.appendLine(`Stopping running task for file: ${normalizedPath}`);
            this.cancelTask(state.taskExecution.task.definition.id);
        } else {
            this.outputChannel.appendLine(`No running task found for file: ${normalizedPath}, checking queued tasks.`);
            
            // Check if the file iss queued
            const requestIndex = requests.findIndex(req => path.normalize(req.file) === normalizedPath);
            if (requestIndex > -1) {
                this.outputChannel.appendLine(`Found queued task for file: ${normalizedPath}, removing from queue.`);
                // Remove task from queue
                requests.splice(requestIndex, 1);
                this.updateFileState(normalizedPath, { inProgress: false, taskExecution: undefined });
                this.outputChannel.appendLine(`Queued task removed for file: ${normalizedPath}`);
            } else {
                this.outputChannel.appendLine(`No process running or queued for file: ${normalizedPath}`);
            }
        }
    
        this.outputChannel.appendLine(`Current runningTasks: ${JSON.stringify([...runningTasks.keys()])}`);
        this.outputChannel.appendLine(`Current fileProcessMap: ${JSON.stringify([...fileProcessMap.entries()])}`);
    }

    async cancelTask(id: number) {
        this.outputChannel.appendLine(`Cancelling task with id - ${id}`);
        const exeProcess = runningTasks.get(id);
        if (exeProcess) {
            const taskExecution = exeProcess.taskExecution;
            const taskId = taskExecution?.task?.definition?.id;

            this.outputChannel.appendLine(`Task definition: ${JSON.stringify(taskExecution?.task?.definition)}`);
    
            if (taskId) {
                taskExecution.terminate();
                runningTasks.delete(id);
                this.outputChannel.appendLine(`Task ${id} cancelled.`);
    
                if (exeProcess.workerType === 'kai') {
                    this.activeKaiTasks.delete(id);
                } else if (exeProcess.workerType === 'kantra') {
                    this.activeKantraTasks.delete(id);
                }
    
                // Update file state
                const file = [...fileProcessMap.entries()].find(([, state]) => state.taskExecution?.task?.definition?.id === taskId)?.[0];
                if (file) {
                    this.updateFileState(file, { inProgress: false, taskExecution: undefined });
                }
            } else {
                this.outputChannel.appendLine(`Task ID is undefined or not found. Cannot cancel task.`);
            }
        } 
        this.processQueue(); 
    }    
}

class SimplePseudoterminal implements vscode.Pseudoterminal {
    private readonly writeEmitter = new vscode.EventEmitter<string>();
    private readonly closeEmitter = new vscode.EventEmitter<void>();
    private readonly request: Requests;
    private outputChannel: vscode.OutputChannel;
    private controller: ProcessController;

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    onDidClose?: vscode.Event<void> = this.closeEmitter.event;

    constructor(request: Requests, outputChannel: vscode.OutputChannel, controller: ProcessController) {
        this.request = request;
        this.outputChannel = outputChannel;
        this.controller = controller;
    }

    open(initialDimensions: vscode.TerminalDimensions | undefined): void {
        this.runTask();
    }

    close(): void {}

    private async runTask(): Promise<void> {
        if (!runningTasks.has(this.request.id)) {
            this.closeEmitter.fire();
            return;
        }

        let result: any;
        if (this.request.type === 'kai') {
            result = await this.callKaiBackend();
        } else if (this.request.type === 'kantra') {
            result = await this.runKantraBinary(this.request.data);
        }

        if (runningTasks.has(this.request.id)) {
            this.closeEmitter.fire();
            this.controller.completeTask(this.request, result);
        }
    }

    private async callKaiBackend(): Promise<any> {
        this.outputChannel.appendLine(`Calling Kai backend for task ${this.request.name}`);
        
        const postData = this.request.data;

        const url = 'http://0.0.0.0:8080/get_incident_solutions_for_file';
        const headers = {
            'Content-Type': 'application/json',
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(postData),
            });

            if (!response.ok) {
                this.outputChannel.appendLine(`Error: ${response.statusText}`);
                return { error: `HTTP error! status: ${response.status}` };
            }

            const responseText = await response.json();
            this.outputChannel.appendLine(`Kai backend processed for task ${this.request.name}`);
            return { result: responseText };
        } catch (error) {
            this.outputChannel.appendLine(`Error making POST request: ${error}`);
            return { error: `Failed to perform the operation. ${error}` };
        }
    }

    private async runKantraBinary(fileNode :FileNode): Promise<any> {
        this.outputChannel.appendLine(`Running Kantra task for task ${this.request.name}`);
        vscode.commands.executeCommand('rhamt.rerun', fileNode);
        return new Promise<any>((resolve) => {
            setTimeout(() => {
                if (!runningTasks.has(this.request.id)) {
                    resolve({});
                    return;
                }
                this.outputChannel.appendLine(`hi from kantra`);
                resolve({ result: "Kantra binary result" }); 
            }, 120000); 
        });
    }
}

export class MyTaskProvider implements vscode.TaskProvider {
    private processController: ProcessController;

    constructor(outputChannel: vscode.OutputChannel, kaiFixDetails: any) {
        // Initialize with 2 kai and 2 kantra workers
        this.processController = new ProcessController(2, 2, outputChannel, kaiFixDetails); 
    }

    provideTasks(token: vscode.CancellationToken): vscode.ProviderResult<vscode.Task[]> {
        return [];
    }

    resolveTask(task: vscode.Task, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Task> {
        return undefined;
    }

    cancelTask(id: number) {
        this.processController.cancelTask(id);
    }
    processQueue() {
        this.processController.processQueue();
    }
    stopTask(filePath: string){
        this.processController.stopTask(filePath);
    }
}