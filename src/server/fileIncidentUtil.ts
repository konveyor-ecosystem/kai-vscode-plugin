import * as fs from 'fs';
import * as yaml from 'yaml';
import * as path from 'path';

export interface Incident {
    uri: string;
    message: string;
    codeSnip?: string;
    lineNumber?: number;
    variables?: any;
    severity?: number;
    ruleId?: string; 
    violationDescription?: string; 
    ruleSetDescription?: string; 
    rulesetName?: string; 
    category?: string; 
}

export class FileIncidentManager {
    private fileIncidentsMap: Map<string, Incident[]> = new Map();
    private incidentsFilePath: string;
    outputFilePath: string;

    constructor(outputFilePath: string, fullAnalysis: boolean) {
        this.outputFilePath = outputFilePath;
        this.incidentsFilePath = path.join(path.dirname(outputFilePath), 'fileincidents.json');

        if (fullAnalysis) {
            this.parseOutputYaml();
            this.saveIncidentsToFile();
        } else {
            if (fs.existsSync(this.incidentsFilePath)) {
                this.loadFromIncidentsFile();
            } else {
                console.log(`Fully parsed incidents file not found`);
            }
        }
    }

    // Parses the output.yaml and extracts relevant fields for incidents
    public parseOutputYaml() {
        const yamlContent = fs.readFileSync(this.outputFilePath, 'utf8');
        const parsedData = yaml.parse(yamlContent);

        for (const ruleset of parsedData) {
            for (const key of ['violations']) {
                if (ruleset[key]) {
                    for (const violationKey in ruleset[key]) {
                        const violation = ruleset[key][violationKey];
                        const incidents = violation.incidents || [];
                        for (const incident of incidents) {
                            const filePath = this.extractFilePath(incident.uri);

                            const incidentEntry: Incident = {
                                uri: incident.uri,
                                message: incident.message,
                                codeSnip: incident.codeSnip,
                                lineNumber: incident.lineNumber || 1,
                                variables: incident.variables || {},
                                severity: incident.severity || 0,
                                ruleId: violationKey, 
                                violationDescription: violation.description, 
                                ruleSetDescription: ruleset.description, 
                                rulesetName: ruleset.name, 
                                category: violation.category 
                            };

                            if (!this.fileIncidentsMap.has(filePath)) {
                                this.fileIncidentsMap.set(filePath, []);
                            }
                            this.fileIncidentsMap.get(filePath)?.push(incidentEntry);
                        }
                    }
                }
            }
        }
    }

    // Extracts the file path from the URI in the output.yaml
    private extractFilePath(uri: string): string {
        return path.normalize(uri.replace('file://', ''));
    }

    // Get incidents for a specific file
    public getIncidentsForFile(filePath: string): Incident[] | undefined {
        return this.fileIncidentsMap.get(path.normalize(filePath));
    }

    // Update the incidents for a specific file
    public async updateFileIncidents(outputFilePathForSpecificFile: string, filePath: string) {
        const yamlContent = fs.readFileSync(outputFilePathForSpecificFile, 'utf8');
        const parsedData = yaml.parse(yamlContent);
        const newIncidents: Incident[] = [];

        // Parse the incidents for this specific file
        for (const ruleset of parsedData) {
            for (const key of ['violations']) {
                if (ruleset[key]) {
                    for (const violationKey in ruleset[key]) {
                        const violation = ruleset[key][violationKey];
                        const incidents = violation.incidents || [];
                        for (const incident of incidents) {
                            const incidentFilePath = this.extractFilePath(incident.uri);
                            if (path.normalize(incidentFilePath) === path.normalize(filePath)) {
                                const incidentEntry: Incident = {
                                    uri: incident.uri,
                                    message: incident.message,
                                    codeSnip: incident.codeSnip,
                                    lineNumber: incident.lineNumber || 1,
                                    variables: incident.variables || {},
                                    severity: incident.severity || 0,
                                    ruleId: violationKey, 
                                    violationDescription: violation.description, 
                                    ruleSetDescription: ruleset.description, 
                                    rulesetName: ruleset.name, 
                                    category: violation.category 
                                };
                                newIncidents.push(incidentEntry);
                            }
                        }
                    }
                }
            }
        }

        // Update the incidents for the specific file in the map
        this.fileIncidentsMap.set(path.normalize(filePath), newIncidents);
    }

    public logAllIncidents() {
        for (const [filePath, incidents] of this.fileIncidentsMap.entries()) {
            console.log(`File: ${filePath}`);
            console.log(`Incidents: ${JSON.stringify(incidents, null, 2)}`);
        }
    }

    public getIncidentsMap(): Map<string, Incident[]> {
        return this.fileIncidentsMap;
    }

    // Save the incidents map to the file
    public saveIncidentsToFile() {
        const serializedData = JSON.stringify(Array.from(this.fileIncidentsMap.entries()), null, 2);
        fs.writeFileSync(this.incidentsFilePath, serializedData, 'utf8');
    }

    // Load the incidents from the previously saved file
    private loadFromIncidentsFile() {
        const fileContent = fs.readFileSync(this.incidentsFilePath, 'utf8');
        const parsedEntries = JSON.parse(fileContent) as [string, Incident[]][];
        this.fileIncidentsMap = new Map(parsedEntries);
    }
}