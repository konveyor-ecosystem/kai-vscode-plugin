/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { EventEmitter, ThemeColor, ThemeIcon, TreeItem, window } from 'vscode';
import { AbstractNode, ITreeNode } from './abstractNode';
import { DataProvider } from './dataProvider';
import { RhamtConfiguration } from '../server/analyzerModel';
import { ModelService } from '../model/modelService';
import * as path from 'path';
import { ConfigurationNode } from './configurationNode';
import { FileItem } from './fileItem';
import { HintNode } from './hintNode';
import { HintsNode } from './hintsNode';
import { ClassificationsNode } from './classificationsNode';
import { ClassificationNode } from './classificationNode';

export class FileNode extends AbstractNode<FileItem> {
    private loading: boolean = false;
    private children = [];
    private issues = [];
    private configforKai: RhamtConfiguration;
    file: string;
    public inProgress: boolean = false;
    private static fileNodeMap: Map<string, FileNode> = new Map();

    constructor(
        config: RhamtConfiguration,
        file: string,
        modelService: ModelService,
        onNodeCreateEmitter: EventEmitter<ITreeNode>,
        dataProvider: DataProvider,
        root: ConfigurationNode) {
        super(config, modelService, onNodeCreateEmitter, dataProvider);
        this.file = file;
        this.root = root;
        this.configforKai = config;
        FileNode.fileNodeMap.set(file, this); 
    }

    createItem(): FileItem {
        this.treeItem = new FileItem(this.file);
        this.loading = false;
        this.refresh();
        return this.treeItem;
    }

    delete(): Promise<void> {
        return Promise.resolve();
    }

    getLabel(): string {
        console.log('File Node Label for: ' + this.file);
        console.log('File Node Label: ' + path.basename(this.file));
        return path.basename(this.file);
    }

    public getChildrenCount(): number {
        return this.issues.length;
    }

    public getConfig(): RhamtConfiguration {
        return this.configforKai;
    }

    public getChildren(): Promise<ITreeNode[]> {
        if (this.loading) {
            return Promise.resolve([]);
        }
        return Promise.resolve(this.children);
    }

    public hasMoreChildren(): boolean {
        return this.children.length > 0;
    }
    public setIssues(newIssues: any[]): void {
        this.issues = newIssues;
    }
    
    refresh(node?: ITreeNode<TreeItem>, type?: string): void {
        this.children = [];
        const ext = path.extname(this.file);

        if (this.inProgress && type) {
            switch (type) {
                case 'analyzing':
                    this.treeItem.iconPath = new ThemeIcon('sync~spin', new ThemeColor('kaiFix.analyzing'));
                    this.treeItem.label = `Analyzing: ${path.basename(this.file)}`;
                    this.treeItem.tooltip = 'Analyzing Incidents';
                    window.showInformationMessage(`FileNode is getting signal of Analyzing`);
                    break;
                case 'fixing':
                    this.treeItem.iconPath = new ThemeIcon('loading~spin', new ThemeColor('kaiFix.fixing'));
                    this.treeItem.label = `Fixing: ${path.basename(this.file)}`;
                    this.treeItem.tooltip = 'Fixing Incidents';
                    window.showInformationMessage(`FileNode is getting signal of Fixing`);
                    break;
                default:
                    this.treeItem.iconPath = new ThemeIcon('sync~spin');
                    this.treeItem.label = path.basename(this.file);
                    this.treeItem.tooltip = '';
                    break;
            }
        } else if (process.env.CHE_WORKSPACE_NAMESPACE) {
            this.treeItem.iconPath = ext === '.xml' ? 'fa fa-file-o medium-orange' :
                ext === '.java' ? 'fa fa-file-o medium-orange' :
                'fa fa-file';
            this.treeItem.label = path.basename(this.file);
            this.treeItem.tooltip = '';
        } else {
            const icon = ext === '.xml' ? 'file_type_xml.svg' :
                ext === '.java' ? 'file_type_class.svg' :
                'default_file.svg';
            const base = [__dirname, '..', '..', '..', 'resources'];
            this.treeItem.iconPath = {
                light: path.join(...base, 'light', icon),
                dark: path.join(...base, 'dark', icon)
            };
            this.treeItem.label = path.basename(this.file);
            this.treeItem.tooltip = '';
        }

        this.issues = this.root.getChildNodes(this);
        if (this.issues.find(issue => issue instanceof HintNode)) {
            this.children.push(new HintsNode(
                this.config,
                this.file,
                this.modelService,
                this.onNodeCreateEmitter,
                this.dataProvider,
                this.root));
        }
        if (this.issues.find(issue => issue instanceof ClassificationNode)) {
            this.children.push(new ClassificationsNode(
                this.config,
                this.file,
                this.modelService,
                this.onNodeCreateEmitter,
                this.dataProvider,
                this.root));
        }
        this.dataProvider.refreshNode(this); // Ensure the tree view is refreshed
    }

    public setInProgress(inProgress: boolean, type?: string): void {
        this.inProgress = inProgress;
        this.refresh(undefined, type);
    }

    public static getFileNodeByPath(filepath: string): FileNode | undefined {
        return FileNode.fileNodeMap.get(filepath);
    }
}
