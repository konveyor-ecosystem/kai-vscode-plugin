/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { rhamtEvents } from '../events';
import { AnalysisResultsSummary, AnalyzerResults } from './analyzerResults';
import * as path from 'path';
import { FileIncidentManager } from './fileIncidentUtil';

export class RhamtModel {

    public configurations: RhamtConfiguration[] = [];

    public exists(name: string): boolean {
        for (const config of this.configurations) {
            if (config.name === name) {
                return true;
            }
        }
        return false;
    }
}

export namespace AnalysisState {
    export const ANALYZING = 0;
    export const STOPPED = 1;
    export const COMPLETED = 2;
}

export namespace ChangeType {
    export const MODIFIED = 0;
    export const ADDED = 1;
    export const DELETED = 2;
    export const PROGRESS = 3;
    export const CANCELLED = 4;
    export const ERROR = 5;
    export const COMPLETE = 6;
    export const STARTED = 7;
    export const CLONING = 8;
    export const QUICKFIX_APPLIED = 9;
}

export const WINDOW = 'window["apps"] = ';

export interface CloneUpdate {
    readonly input: Clone;
    readonly value: number;
    readonly title: string;
    readonly description?: string;
}

export interface Input {
    id: string;
    path: string;
}

export interface Clone extends Input {
    repo: string;
    starting: boolean;
    cloning: boolean;
    cancelled: boolean;
    completed: boolean;
}

export class RhamtConfiguration {
    onChanged = new rhamtEvents.TypedEvent<{ type: number, name: string, value: any }>();
    id: string;
    name: string;
    summary: AnalysisResultsSummary | undefined;
    delay: 1000;
    rhamtExecutable: string;
    options: { [index: string]: any } = {};
    cancelled: boolean;
    public incidentManager: FileIncidentManager | null = null;
    public _results: AnalyzerResults | null;

    get results(): AnalyzerResults | null {
        return this._results;
    }

    set results(results: AnalyzerResults | null) {
        this._results = results;
    }

    getReport(): string {
        if (!this.summary) return undefined;
        return path.resolve(this.summary.outputLocation, 'static-report', 'index.html');
    }

    sourceBase(): string {
        return 'file:///opt/input/source/';
    }

    getResultsLocation(): string {
        if (!this.options['output']) return undefined;
        return path.resolve(this.options['output'], 'results.xml');
    }

    deleteIssue(issue: IIssue): void {
        this._results.deleteIssue(issue);
    }

    markIssueAsComplete(issue: IIssue, complete: boolean): void {
        this._results.markIssueAsComplete(issue, complete);
    }

    markQuickfixApplied(quickfix: IQuickFix, applied: boolean): void {
        this._results.markQuickfixApplied(quickfix, applied);
    }

    static() {
        return ['static-report', 'output.js'];
    }

    getQuickfixesForResource(resource: string): IQuickFix[] {
        let quickfixes = [];
        if (this._results) {
            this._results.model.hints.forEach(hint => {
                if (hint.file === resource || hint.file.includes(resource)) {
                    quickfixes = quickfixes.concat(hint.quickfixes)
                }
            });
            this._results.model.classifications.forEach(classification => {
                if (classification.file === resource || classification.file.includes(resource)) {
                    quickfixes = quickfixes.concat(classification.quickfixes)
                }
            });
        }
        return quickfixes;
    }
}

export interface IUniqueElement {
    id: string;
}

export interface ILink extends IUniqueElement {
    title: string;
    url: string;
}

export interface IIssue extends IUniqueElement {
    type: IIssueType;
    title: string;
    quickfixes: IQuickFix[];
    file: string;
    severity: string;
    ruleId: string;
    ruleSetDiscription: string;
    violationDiscription: string;
    rulesetName: string;
    effort: string;
    links: ILink[];
    report: string;
    category: string;
    configuration: RhamtConfiguration;
    dom: any;
    complete: boolean;
    origin: string;
}

export enum IIssueType {
    Hint,
    Classification
}
export type IQuickFixType = 'REPLACE' | 'DELETE_LINE' | 'INSERT_LINE' | 'TRANSFORMATION';

export interface IQuickFix extends IUniqueElement {
    issue: IIssue;
    type: IQuickFixType;
    searchString: string;
    replacementString: string;
    newLine: string;
    transformationId: string;
    name: string;
    file: string;
    quickfixApplied: boolean;
    dom: any;
}

export interface ReportHolder {
    getReport: () => string;
}

export interface IssueContainer {
    getIssue?: () => IIssue;
    setComplete?: (complete: boolean) => void;
}

export interface IHint extends IIssue {
    lineNumber: number;
    column: number;
    length: number;
    sourceSnippet: string;
    hint: string;
    variables: Map<string,string>;
}

export interface IClassification extends IIssue {
    description: string;
}

export interface Endpoints {
    reportLocation(): Promise<string>;
    reportPort(): string;
    resourcesRoot(): any;
    configurationResourceRoot(): string;
    configurationPort(): string;
    configurationLocation(config?: RhamtConfiguration): Promise<string>;
    isReady: boolean;
    ready: Promise<void>;
}
