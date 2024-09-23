/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { ModelService } from '../model/modelService';
import { IClassification, IHint, IIssue, IIssueType, IQuickFix, RhamtConfiguration } from './analyzerModel';
import * as vscode from 'vscode';
import { FileIncidentManager, Incident } from './fileIncidentUtil';

export interface AnalysisResultsSummary {
    skippedReports?: boolean;
    executedTimestamp?: string;
    executionDuration?: string;
    outputLocation?: string;
    executable?: string;
    quickfixes?: any;
    hintCount?: number,
    classificationCount?: number;
    quickfixCount?: number;
    executedTimestampRaw?: string,
    active?: boolean,
    activatedExplicity?: boolean
}

export class AnalysisResultsUtil {

    static openReport(report: string): void {
    }
}

export class AnalyzerResults {

    reports: Map<string, string> = new Map<string, string>();
    config: RhamtConfiguration;
    incidentManager: FileIncidentManager; 
    private _model: AnalyzerResults.Model;
     
   
    constructor(incidentManager: FileIncidentManager, config: RhamtConfiguration) {

        this.config = config;
        this.incidentManager = incidentManager;
    }

    init(): Promise<void> {
        // Initialize the model to store hints and classifications
        this._model = {
            hints: [],
            classifications: [],
            issueByFile: new Map<string, IHint[]>() 
        };
    
        // Create an output channel for logging
        const outputChannel1 = vscode.window.createOutputChannel("Analyzer Result");
        outputChannel1.show(true);
    
        try {
            if (!this.incidentManager) {
                console.error('Incident Manager is undefined');
                return;
            }
            // Get the incidents map from the incident manager
            const incidentsMap = this.incidentManager.getIncidentsMap();
    
            // Log the incidents map for debugging
            outputChannel1.appendLine(`Loaded incidents map with ${incidentsMap.size} files`);
    
            // Iterate over each file and its associated incidents
            incidentsMap.forEach((incidents: Incident[], fileUri: string) => {
                outputChannel1.appendLine(`Processing ${incidents.length} incidents for file: ${fileUri}`);
    
                // Iterate over each incident in the file
                incidents.forEach(incident => {
                    try {
                        outputChannel1.appendLine(`Incident: ${JSON.stringify(incident, null, 2)}`);
                        const hint: IHint = {
                            type: IIssueType.Hint,
                            id: ModelService.generateUniqueId(),
                            quickfixes: [],
                            file: vscode.Uri.parse(incident.uri).fsPath,
                            severity: incident.severity ? incident.severity.toString() : '',
                            ruleId: incident.ruleId || '',
                            violationDiscription: incident.violationDescription || '',
                            ruleSetDiscription: incident.ruleSetDescription || '',
                            rulesetName: incident.rulesetName || '',
                            effort: '',
                            title: incident.message,
                            links: [],
                            report: '',
                            lineNumber: incident.lineNumber || 1,
                            column: 0,
                            length: 0,
                            sourceSnippet: incident.codeSnip ? incident.codeSnip : '',
                            category: incident.category || '',
                            hint: incident.message,
                            configuration: this.config,
                            dom: incident,
                            complete: false,
                            origin: '',
                            variables: incident.variables ? incident.variables : {}
                        };
                        
                        // Add the hint to the model
                        this._model.hints.push(hint);
    
                        // Check if there are existing hints for this file
                        const existingHintsForFile = this._model.issueByFile.get(fileUri);
                        if (existingHintsForFile) {
                            existingHintsForFile.push(hint);
                        } else {
                            this._model.issueByFile.set(fileUri, [hint]);
                            outputChannel1.appendLine(`Created new entry for file: ${fileUri}`);
                        }
                    } catch (error) {
                        console.error(`Error processing incident for file ${fileUri}:`, error);
                        outputChannel1.appendLine(`Error processing incident: ${error.message}`);
                    }
                });
            });
    
            return Promise.resolve();
        } catch (error) {
            console.error('Error initializing analyzer results:', error);
            outputChannel1.appendLine(`Error initializing analyzer results: ${error.message}`);
            return Promise.reject(error);
        }
    }
    
    get model(): AnalyzerResults.Model | null {
        return this._model;
    }
    
    deleteIssue(issue: IIssue): void {
    }

    markIssueAsComplete(issue: IIssue, complete: boolean): void {
    }

    markQuickfixApplied(quickfix: IQuickFix, applied: boolean): void {
        if (applied) {
        }
        else {
        }
    }
}

export namespace AnalyzerResults {
    
    export interface Model {
        hints: IHint[];
        classifications: IClassification[];
        issueByFile: Map<string, IHint[]>; 
        
    }
}

