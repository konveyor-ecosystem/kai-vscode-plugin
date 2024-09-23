/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { window, ThemeColor } from 'vscode';
import { IHint } from '../server/analyzerModel';
import { ModelService } from '../model/modelService';

export const HINT = 'migration';

export class MarkerService {

    private diagnostics = vscode.languages.createDiagnosticCollection("cli");
    private unfixedHintDecorationType = window.createTextEditorDecorationType({
        backgroundColor: new ThemeColor('editor.stackFrameHighlightBackground')
    });

    constructor(
        private context: vscode.ExtensionContext, 
        private modelService: ModelService) {
            this.initMarkerSupport();
    }

    private initMarkerSupport(): void {
        const context = this.context;
        context.subscriptions.push(this.diagnostics);
        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor) {
                    this.refreshHints(editor.document, editor);
                }
            })
        );
        context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(e => this.refreshHints(e.document)));
        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument(doc => this.refreshHints(doc)));
        context.subscriptions.push(
            vscode.workspace.onDidCloseTextDocument(doc => {
                this.diagnostics.delete(doc.uri);
            }
        ));
        this.refreshOpenEditors();
    }

    public refreshOpenEditors(file?: string): void {
        console.log(`Attempting to refresh open editors for file: ${file || "all files"}`);

        const activeEditor = vscode.window.activeTextEditor;
        
        // Refresh active editor if it's for the specific file or if no file is specified
        if (activeEditor && (!file || activeEditor.document.uri.fsPath === file)) {
            console.log(`Refreshing active editor for file: ${activeEditor.document.uri.fsPath}`);
            this.refreshHints(activeEditor.document, activeEditor);
        }

        // Refresh visible editors
        vscode.window.visibleTextEditors.forEach(editor => {
            console.log(`Checking visible editor for file: ${editor.document.uri.fsPath}`);
            if (!file || editor.document.uri.fsPath === file) {
                console.log(`Refreshing visible editor for file: ${editor.document.uri.fsPath}`);
                this.refreshHints(editor.document, editor);
            }
        });
    }

    private refreshHints(doc: vscode.TextDocument, editor?: vscode.TextEditor): void {
        try {
            console.log(`Refreshing hints for document: ${doc.uri.fsPath}`);
            
            const diagnostics: vscode.Diagnostic[] = [];
            const decorations = [new vscode.Range(0, 0, 0, 0)];
            this.diagnostics.delete(doc.uri);
            
            this.modelService.getActiveHints().filter(issue => doc.uri.fsPath === issue.file).forEach(issue => {
                try {
                    const diagnostic = this.createDiagnostic(doc, issue);
                    if (diagnostic) {
                        diagnostics.push(diagnostic);
                        const lineNumber = issue.lineNumber - 1;
                        const range = new vscode.Range(lineNumber, issue.column, lineNumber, issue.length + issue.column);
                        decorations.push(range);
                    }
                } catch (e) {
                    console.log('Error creating incident diagnostic.');
                    console.log(e);                    
                }
            });
            
            try {
                if (diagnostics.length > 0) {
                    console.log(`Setting ${diagnostics.length} diagnostics for document: ${doc.uri.fsPath}`);
                    this.diagnostics.set(doc.uri, diagnostics);
                }
                if (editor) {
                    editor.setDecorations(this.unfixedHintDecorationType, decorations);
                }
            } catch (e) {
                console.log('Error setting incident diagnostic.');
                console.log(e);
            }
        } catch (e) {
            console.log(e);
        }
    }

    private createDiagnostic(doc: vscode.TextDocument, issue: IHint): vscode.Diagnostic | undefined {
        if (issue.complete) return undefined;
        const lineNumber = issue.lineNumber - 1;
        const lineOfText = doc.lineAt(lineNumber);
        if (lineOfText.isEmptyOrWhitespace) {
            return undefined;
        }
        try {
            const severity = this.convertSeverity(issue);
            const range = new vscode.Range(lineNumber, issue.column, lineNumber, issue.length + issue.column);
            const title = issue.hint ? issue.hint : 'unknown-incident-title';
            console.log(`range - ${range}`);
            console.log(`title - ${title}`);
            console.log(`severity ${severity}`);
            
            const diagnostic = new vscode.Diagnostic(range, title, severity);
            diagnostic.code = `${HINT} :: ${issue.configuration.id} :: ${issue.id}`;
            return diagnostic;
        } catch (e) {
            console.log('Error creating diagnostic.');            
            console.log(e);
            return undefined;
        }
    }

    private convertSeverity(hint: IHint): vscode.DiagnosticSeverity {
        let severity: vscode.DiagnosticSeverity = vscode.DiagnosticSeverity.Information;
        if (!hint.category || hint.category.includes('error') || hint.category.includes('mandatory')) {
            severity = vscode.DiagnosticSeverity.Error;
        } else if (hint.category.includes('potential')) {
            severity = vscode.DiagnosticSeverity.Warning;
        }
        return severity;
    }
}
