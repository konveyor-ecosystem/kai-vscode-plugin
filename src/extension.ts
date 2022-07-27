/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Utils } from './Utils';
import * as path from 'path';
import { RhamtView } from './explorer/rhamtView';
import { ModelService } from './model/modelService';
import { RhamtModel, IssueContainer, Endpoints } from './model/model';
import { IssueDetailsView } from './issueDetails/issueDetailsView';
import { ReportView } from './report/reportView';
import { ConfigurationEditorServer } from './editor/configurationEditorServer';
import { ConfigurationEditorService } from './editor/configurationEditorService';
import { HintItem } from './tree/hintItem';
import { HintNode } from './tree/hintNode';
import { NewRulesetWizard } from './wizard/newRulesetWizard';
import * as endpoints from './server/endpoints';
import { ReportServer } from './report/reportServer';
import { ConfigurationEditorSerializer } from './editor/configurationEditorSerializer';
import { QuickfixContentProvider } from './quickfix/contentProvider';
import { QuickfixedResourceProvider } from './quickfix/quickfixedResourceProvider';
import * as os from 'os';
import { MarkerService } from './source/markers';
import { initQuickfixSupport } from './source/quickfix';
import { FileItem } from './tree/fileItem';
import * as git from './source/git';

let detailsView: IssueDetailsView;
let modelService: ModelService;
let stateLocation: string;
let outputLocation: string;
let configEditorServer: ConfigurationEditorServer;
let reportServer: ReportServer | undefined = undefined;

export async function activate(context: vscode.ExtensionContext) {
    if (vscode.env.appName === "Eclipse Che") {
        stateLocation = path.join('/home', 'theia', 'mtr', 'redhat.mtr-vscode-extension');
        outputLocation = path.join(os.homedir(), 'output');
    }
    else {
        stateLocation = path.join(context.globalStoragePath, '.mtr', 'tooling', 'vscode');
        outputLocation = stateLocation;
    }

    console.log(`mtr state location is: ${stateLocation}`);
    
    await Utils.loadPackageInfo(context);
    const out = path.join(stateLocation);
    const locations = await endpoints.getEndpoints(context, out);
    modelService = new ModelService(new RhamtModel(), out, outputLocation, locations);
    const configEditorService = new ConfigurationEditorService(context, modelService);
    await modelService.readCliMeta();
    if (MTR.isChe()) {
        reportServer = await MTR.createReportServer(locations);
    }

    const markerService = new MarkerService(context, modelService);
    new RhamtView(context, modelService, configEditorService, markerService);
    new ReportView(context, locations);
    detailsView = new IssueDetailsView(context, locations, modelService);

    // const statusBar = new StatusBar();
    // const decorationsProvider = new DecorationsProvider(modelService, statusBar);
    // const toggleMtaHintsCommand = vscode.commands.registerCommand(
    //     StatusBar.toggleMtaHintsCommand,
    //   () => decorationsProvider.toggleHints()
    // );
    // context.subscriptions.push(vscode.Disposable.from(toggleMtaHintsCommand));

    initQuickfixSupport(context, modelService);
    
    context.subscriptions.push(vscode.commands.registerCommand('rhamt.openDoc', async (data) => {
        if (data instanceof FileItem) {
            openFile(vscode.Uri.file(data.file));
            return;
        }
        const issue = (data as IssueContainer).getIssue();
        detailsView.open(issue);
        let item: HintItem;
        if (data instanceof HintNode) {
            item = (data as HintNode).item;
        }
        else if (data instanceof HintItem) {
            item = data;
        }
        const uri = vscode.Uri.file(issue.file);
        await openFile(uri);
        if (item) {
            vscode.window.visibleTextEditors.filter(editor => editor.document.uri.fsPath === uri.fsPath).forEach(editor => {
                editor.selection = new vscode.Selection(
                    new vscode.Position(item.getLineNumber(), item.getColumn()),
                    new vscode.Position(item.getLineNumber(), item.getLength())
                );
                editor.revealRange(new vscode.Range(item.getLineNumber(), 0, item.getLineNumber() + 1, 0), vscode.TextEditorRevealType.InCenter);
            });
        }
    }));

    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(doc => {
        if (doc.fileName === modelService.getModelPersistanceLocation()) {
            modelService.reload().then(() => {
                vscode.commands.executeCommand('rhamt.modelReload');
            }).catch(e => {
                vscode.window.showErrorMessage(`Error reloading configurations - ${e}`);
            });
        }
    }));

    const newRulesetDisposable = vscode.commands.registerCommand('rhamt.newRuleset', async () => {
        new NewRulesetWizard(modelService).open();
    }); 
    context.subscriptions.push(newRulesetDisposable);
    // const download = (!Private.isChe() && !Private.isVSCode());
    Utils.checkCli(modelService.outDir, context, true);

    vscode.window.registerWebviewPanelSerializer('rhamtConfigurationEditor', new ConfigurationEditorSerializer(modelService, configEditorService));

    const quickfixContentProvider = new QuickfixContentProvider(modelService);
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('quickfix', quickfixContentProvider));

    const quickfixedProvider = new QuickfixedResourceProvider(modelService);
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('quickfixed', quickfixedProvider));

    // vscode.languages.registerCodeLensProvider("*", lensProvider);
    // const hintDecorationProvider = new HintDecorationProvider(modelService);
    // vscode.window.registerFileDecorationProvider()

    git.init(context);
}

export async function openFile(uri: vscode.Uri): Promise<void> {
    let activeEditor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.fsPath === uri.fsPath);
    if (!activeEditor) {
        try {
            await vscode.commands.executeCommand('vscode.open', uri);
        } catch (e) {
            console.log(`Error while opening file: ${e}`);
            vscode.window.showErrorMessage(e);
            return;
        }
    } 
    else {
        await vscode.window.showTextDocument(activeEditor.document, {viewColumn: activeEditor.viewColumn});
    }
}

export function deactivate() {
    modelService.save();
    configEditorServer.dispose();
    if (MTR.isChe()) {
        reportServer.dispose();
    }
}

export namespace MTR {
    export async function createReportServer(endpoints: Endpoints): Promise<ReportServer> {
        const reportServer = new ReportServer(endpoints);
        try {
            reportServer.start();    
        } catch (e) {
            console.log(`Error while starting report server: ${e}`);
        }
        return reportServer;
    }
    export function isChe(): boolean {
        return vscode.env.appName === "Eclipse Che";
    }
    export function isVSCode(): boolean {
        return vscode.env.appName === "Visual Studio Code";
    }
}
