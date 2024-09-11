/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { window, ExtensionContext, commands, TreeView} from 'vscode';
import { DataProvider } from '../tree/dataProvider';
import { ModelService } from '../model/modelService';
import { ConfigurationEditorService } from '../editor/configurationEditorService';
import { RhamtConfiguration } from '../server/analyzerModel';
import { MarkerService } from '../source/markers';
import { AnalyzerUtil } from '../server/analyzerUtil';
import { ProviderName, LocalProviderRunner, providerBinaryPath, writeProviderSettingsFile, getProviderConfigs } from '../server/providerUtil';
import { providerChannel, rhamtChannel } from '../util/console';
import * as path from "path";
import * as fs from 'fs';
import { FileNode } from '../tree/fileNode';

export class RhamtExplorer {
    constructor(private context: ExtensionContext,
        private modelService: ModelService,
        private configEditorService: ConfigurationEditorService,
        private markerService: MarkerService,
        private dataProvider: DataProvider) {
        this.createViewer();
        this.createCommands();
    }

    private createCommands(): void {
        this.context.subscriptions.push(commands.registerCommand('rhamt.deleteConfiguration', async item => {
            if (!item) {
                const configs = this.modelService.model.configurations.map(config => config.name);
                const choice = await window.showQuickPick(configs);
                if (choice) {
                    const config = this.modelService.getConfigurationWithName(choice);
                    item = {config};
                }
                else {
                    return;
                }
            }
            const config = item.config;
            try {
                const deleted = await this.modelService.deleteConfiguration(config);
                if (deleted) {
                    this.configEditorService.closeEditor(config);
                }
                this.dataProvider.remove(config);
                AnalyzerUtil.updateRunEnablement(true, this.dataProvider, config);
                if (AnalyzerUtil.activeProcessController) {
                    AnalyzerUtil.activeProcessController.shutdown();
                }
            }
            catch (e) {
                console.log(`Error deleting configuration: ${e}`);
                window.showErrorMessage(`Error deleting configuration.`);
            }
        }));
        this.dataProvider.context.subscriptions.push(commands.registerCommand('rhamt.deleteIssue', async item => {
            try {
                item.root.deleteIssue(item);
                await this.modelService.saveAnalysisResults(item.root.config);
            }
            catch (e) {
                console.log(`Error saving analysis results: ${e}`);
                window.showErrorMessage(e);
            }
        }));
        this.dataProvider.context.subscriptions.push(commands.registerCommand('rhamt.markIssueAsComplete', item => {
            item.root.setComplete(item, true);
            this.modelService.saveAnalysisResults(item.root.config).catch(e => {
                console.log(`Error saving analysis results: ${e}`);
                window.showErrorMessage(e);
            });
        }));
        this.dataProvider.context.subscriptions.push(commands.registerCommand('rhamt.markIssueAsIncomplete', item => {
            item.root.setComplete(item, false);
            this.modelService.saveAnalysisResults(item.root.config).catch(e => {
                console.log(`Error saving analysis results: ${e}`);
                window.showErrorMessage(e);
            });
        }));
        this.dataProvider.context.subscriptions.push(commands.registerCommand('rhamt.deleteResults', item => {
            const output = item.config.options['output'];
            if (output) {
                this.modelService.deleteOuputLocation(output);
            }
            item.config.results = undefined;
            item.config.summary = undefined;
            this.refreshConfigurations();
        }));
        this.context.subscriptions.push(commands.registerCommand('rhamt.newConfiguration', async () => {
            const config = this.modelService.createConfiguration();
            this.modelService.addConfiguration(config);
            try {
                await this.modelService.save();
            } catch (e) {
                console.log(`Error saving configurtion data: ${e}`);
                window.showErrorMessage(e);
                return;
            }
            await this.configEditorService.openConfiguration(config).catch(e => {
                console.log(`Error opening configuration ${config} with error: ${e}`)
            });
            this.dataProvider.refresh(undefined);
        }));
        this.context.subscriptions.push(commands.registerCommand('rhamt.openConfiguration', item => {
            this.configEditorService.openConfiguration(item.config).catch(e => {
                console.log(`Error opening configuration ${item.config} with error: ${e}`)
            });
        }));
        this.dataProvider.context.subscriptions.push(commands.registerCommand('rhamt.activate', async (item) => {
            try {
                const config = item.config as RhamtConfiguration;
                config.summary.active = config.summary.activatedExplicity = true;
                const configNode = this.dataProvider.getConfigurationNode(config);
                this.refreshConfigurations();
                this.dataProvider.reveal(configNode, true);
                this.markerService.refreshOpenEditors();
                await this.saveModel();
            }
            catch (e) {
                console.log(`Error activating configuration - ${e}`);
                window.showErrorMessage(`Error activating configuration ${e}`);
            }
        }));
        this.dataProvider.context.subscriptions.push(commands.registerCommand('rhamt.deactivate', async (item) => {
            try {
                const config = item.config as RhamtConfiguration;
                config.summary.active = config.summary.activatedExplicity = false;
                this.refreshConfigurations();
                this.markerService.refreshOpenEditors();
                this.saveModel();
            }
            catch (e) {
                console.log(`Error unactivating configuration - ${e}`);
                window.showErrorMessage(`Error unactivating configuration ${e}`);
            }
        }));
        this.dataProvider.context.subscriptions.push(commands.registerCommand('rhamt.runProviders', async (item) => {
            if (!item) {
                const configs = this.modelService.model.configurations.map(config => config.name);
                const choice = await window.showQuickPick(configs);
                if (choice) {
                    const config = this.modelService.getConfigurationWithName(choice);
                    item = {config};
                }
                else {
                    return;
                }                
            }
            const libPath = path.join(this.dataProvider.context.extensionPath, "lib")
            try {
                await LocalProviderRunner.getInstance().run({
                    binaryPath: providerBinaryPath(ProviderName.Java, libPath),
                    name: ProviderName.Java,
                }, providerChannel);
            } catch (e) {
                console.log(`Error setting up provider ${ProviderName.Java}`);
            }
        }));
        this.dataProvider.context.subscriptions.push(commands.registerCommand('rhamt.runConfiguration', async (item) => {
            if (!item) {
                const configs = this.modelService.model.configurations.map(config => config.name);
                const choice = await window.showQuickPick(configs);
                if (choice) {
                    const config = this.modelService.getConfigurationWithName(choice);
                    item = {config};
                }
                else {
                    return;
                }                
            }
            const config = item.config as RhamtConfiguration;
            const libPath = path.join(this.dataProvider.context.extensionPath, 'lib');
            try {
                AnalyzerUtil.updateRunEnablement(false, this.dataProvider, config);
                const providers = LocalProviderRunner.getInstance().providers();
                await writeProviderSettingsFile(config.options['output'], 
                    getProviderConfigs(providers, libPath, config.options['input']));
                await AnalyzerUtil.analyze(
                    undefined,
                    false,
                    this.dataProvider,
                    config,
                    this.modelService,
                    () => {
                        config.results = undefined;
                        config.summary = undefined;
                        this.refreshConfigurations();
                    },
                    () => {});
                if (config.cancelled) {
                    rhamtChannel.print('\nAnalysis canceled');
                    return;
                };
            } catch (e) {
                console.log(e);
                rhamtChannel.print('\nAnalysis failed');
                if (!e.notified) {
                    window.showErrorMessage(`Error running analysis - ${e}`);
                }
                AnalyzerUtil.updateRunEnablement(true, this.dataProvider, config);
                this.refreshConfigurations();
            }
            try {
                await AnalyzerUtil.generateStaticReport(libPath, config, config.options['output'] );
                await AnalyzerUtil.loadAnalyzerResults(config);
                AnalyzerUtil.updateRunEnablement(true, this.dataProvider, config);
                const configNode = this.dataProvider.getConfigurationNode(config);
                configNode.loadResults();
                this.refreshConfigurations();
                this.dataProvider.reveal(configNode, true);
                this.markerService.refreshOpenEditors();
                this.saveModel();
                rhamtChannel.print('\nAnalysis completed successfully');
                window.showInformationMessage('Analysis complete', 'Open Report').then(result => {
                    if (result === 'Open Report') {
                        commands.executeCommand('rhamt.openReportExternal', {
                            config,
                            getReport: () => config.getReport()
                        });
                    }
                });
            } catch (e) {
                console.log(e);
                rhamtChannel.print('\nStatic report generation failed');
                if (!e.notified) {
                    window.showErrorMessage(`Error generating static report - ${e}`);
                }
                AnalyzerUtil.updateRunEnablement(true, this.dataProvider, config);
                this.refreshConfigurations();
            }

        }));
        this.dataProvider.context.subscriptions.push(commands.registerCommand('rhamt.rerun', async (item) => {
            window.showInformationMessage(`rerun`);
            const fileNode = item as FileNode;
            if (!fileNode) {
                window.showErrorMessage('Invalid file node.');
                return;
            }
        
            fileNode.setInProgress(true, "analyzing");
            const config = fileNode.config as RhamtConfiguration;
            const libPath = path.join(this.dataProvider.context.extensionPath, 'lib');
            const filePath = this.getRelativePath(fileNode.file, config.options['input'][0]);
            const fileName = path.basename(filePath, path.extname(filePath));
        
            const newOutputPath = await this.createDirectoryForFile(config.options['output'], fileName);
            window.showInformationMessage(`newOutputPath : ${newOutputPath}`);
        
            const relativeFilePath = path.relative(config.options['input'][0], fileNode.file);
            window.showInformationMessage(`Relative file path: ${relativeFilePath}`);
        
            try {
                const providers = LocalProviderRunner.getInstance().providers();
        
                await writeProviderSettingsFile(
                    newOutputPath,
                    getProviderConfigs(providers, libPath, config.options['input'], relativeFilePath)
                );
        
                await AnalyzerUtil.analyze(
                    newOutputPath,
                    true,
                    this.dataProvider,
                    config,
                    this.modelService,
                    () => {
                        config.results = undefined;
                        config.summary = undefined;
                    },
                    () => {}
                );
        
                if (config.cancelled) {
                    rhamtChannel.print(`\n Analysis canceled for File: ${filePath}`);
                    return;
                }
            } catch (e) {
                console.log(e);
                rhamtChannel.print(`\n Analysis failed for File: ${filePath}`);
                if (e.message) {
                    window.showErrorMessage(`Error running analysis: ${e.message}`);
                }
                fileNode.setInProgress(false);
                this.dataProvider.refreshNode(fileNode);  // Refresh just this node
                return;
            }
        
            try {
                await AnalyzerUtil.generateStaticReport(libPath, config, newOutputPath);
                await AnalyzerUtil.loadAnalyzerResults(config, undefined, newOutputPath);
                AnalyzerUtil.updateRunEnablement(true, this.dataProvider, config);
        
                const issueByFileMap = fileNode.getConfig()._results.model.issueByFile;
                const issueByFile = issueByFileMap.get(fileNode.file);
                window.showInformationMessage(`Issue By File: ${issueByFile}`);
        
                if (!issueByFile) {
                    this.dataProvider.removeFileNode(fileNode);
                    window.showInformationMessage(`FileNode removed: ${fileNode.file}`);
                } else {
                    fileNode.setIssues(issueByFile);
                    fileNode.refresh();
                    this.dataProvider.refreshNode(fileNode);  
                }
        
                this.markerService.refreshOpenEditors(fileNode.file);
                await this.saveModel();
                fileNode.setInProgress(false);
                rhamtChannel.print('\nAnalysis completed successfully');
            } catch (e) {
                console.log(e);
                rhamtChannel.print('\nStatic report generation failed');
                if (e.message) {
                    window.showErrorMessage(`Error generating static report: ${e.message}`);
                }
                AnalyzerUtil.updateRunEnablement(true, this.dataProvider, config);
                fileNode.setInProgress(false);
                this.dataProvider.refreshNode(fileNode);  
            }
        }));
    }
        
    //     this.dataProvider.context.subscriptions.push(commands.registerCommand('rhamt.rerun', async (item) => {
    //         window.showInformationMessage(`rerun`);
    //         const fileNode = item as FileNode;
    //         fileNode.setInProgress(true, "analyzing");
    //         const config = fileNode.config as RhamtConfiguration;
    //         const libPath = path.join(this.dataProvider.context.extensionPath, 'lib');
    //         const filePath = this.getRelativePath(fileNode.file, config.options['input'][0]);
    //         const fileName = path.basename(filePath, path.extname(filePath));

    //         const newOutputPath =  await this.createDirectoryForFile(config.options['output'],fileName);
    //         window.showInformationMessage(`newOutputPath : ${newOutputPath}`);
           
    //         const relativeFilePath = path.relative(config.options['input'][0], fileNode.file);
    //         window.showInformationMessage(`Relative file path: ${relativeFilePath}`);

    //         try {
    //             //AnalyzerUtil.updateRunEnablement(false, this.dataProvider, config);
    //             const providers = LocalProviderRunner.getInstance().providers();

    //             await writeProviderSettingsFile(newOutputPath,
    //                 getProviderConfigs(providers, libPath, config.options['input'], relativeFilePath));
    //             await AnalyzerUtil.analyze(
    //                 newOutputPath,
    //                 true,
    //                 this.dataProvider,
    //                 config,
    //                 this.modelService,
    //                 () => {
    //                     config.results = undefined;
    //                     config.summary = undefined;
    //                 },
    //                 () => {});
    //             if (config.cancelled) {
    //                 rhamtChannel.print(`\n Analysis canceled for File: ${filePath}`);
    //                 return;
    //             };
    //         } catch (e) {
    //             console.log(e);
    //             rhamtChannel.print(`\n Analysis failed for File: ${filePath}`);
    //             if (!e.notified) {
    //                 window.showErrorMessage(`Error running analysis - ${e}`);
    //             }
    //            //AnalyzerUtil.updateRunEnablement(true, this.dataProvider, config);
    //            this.refreshConfigurations();
    //            this.dataProvider.refreshNode(fileNode);
    //         }
    //         try {
    //             await AnalyzerUtil.generateStaticReport(libPath, config, newOutputPath);
    //             await AnalyzerUtil.loadAnalyzerResults(config, undefined ,newOutputPath);
    //             AnalyzerUtil.updateRunEnablement(true, this.dataProvider, config);
    //             // const configNode = this.dataProvider.getConfigurationNode(config);
    //             // configNode.loadResults();
    //             const issueByFileMap = fileNode.getConfig()._results.model.issueByFile;
    //             const issueByFile = issueByFileMap.get(fileNode.file);
    //             window.showInformationMessage(`${issueByFile}`);
    //             if (!issueByFile) {
             
    //                 this.dataProvider.removeFileNode(fileNode);
    //                 window.showInformationMessage(`FileNode removed: ${fileNode.file}`);
    //                 this.dataProvider.refreshNode(fileNode);
                  
    //             } else {
    //                 fileNode.refresh();
    //                 this.dataProvider.refreshNode(fileNode);
    //             }

        
    //             // this.dataProvider.reveal(configNode, true);
    //             this.markerService.refreshOpenEditors();
    //             this.saveModel();
    //             fileNode.setInProgress(false);
    //             rhamtChannel.print('\nAnalysis completed successfully');

    //         } catch (e) {
    //             console.log(e);
    //             rhamtChannel.print('\nStatic report generation failed');
    //             if (!e.notified) {
    //                 window.showErrorMessage(`Error generating static report - ${e}`);
    //             }
    //             AnalyzerUtil.updateRunEnablement(true, this.dataProvider, config);
    //             //this.refreshConfigurations();
    //         }

    //     }));

    //     //AnalyzerUtil.updateRunEnablement(true, this.dataProvider, null);
        
    // }

    private async saveModel(): Promise<void> {
        try {
            // save analysis results, quickfix info, active analysis, etc.
            await this.modelService.save();
        }
        catch (e) {
            console.log(`Error saving analysis results: ${e}`);
            return Promise.reject(`Error saving analysis results: ${e}`);
        }
    }


    private refreshConfigurations(): void {
        this.dataProvider.refreshRoots();
    }

    private createViewer(): TreeView<any> {
        const treeDataProvider = this.dataProvider;
        const viewer = window.createTreeView('rhamtExplorerView', { treeDataProvider });
        // viewer.onDidExpandElement(e => {
        //     console.log(e.element);
        //     if (e.element instanceof FolderNode) {
        //     }
        // });
        this.context.subscriptions.push(viewer);
        this.dataProvider.setView(viewer);
        return viewer;
    }
    private getRelativePath(fullPath: string, input: string): string {
   
        if (!input.endsWith('/')) {
            input += '/';
        }
        fullPath.replace(input, '');
        return path.basename(fullPath);
    }

    async  createDirectoryForFile(outputPath: string, inputPath: string) {
        const fileName = path.basename(inputPath, path.extname(inputPath)); // Get file name without extension
        const newDirPath = path.join(outputPath, fileName); // Combine output path with new directory name
    
        try {
            this.ensureDirectoryExists(newDirPath);
            console.log(`Directory created: ${newDirPath}`);
            return newDirPath;
        } catch (error) {
            console.error(`Failed to create directory: ${error}`);
            throw error; 
        }
    }

    private ensureDirectoryExists(directory: string) {
        const dirPath = path.resolve(directory);
        if (fs.existsSync(dirPath)) {
            return;
        }
        dirPath.split(path.sep).reduce((currentPath, folder) => {
            currentPath += folder + path.sep;
            if (!fs.existsSync(currentPath)) {
                fs.mkdirSync(currentPath);
            }
            return currentPath;
        }, '');
    }
}