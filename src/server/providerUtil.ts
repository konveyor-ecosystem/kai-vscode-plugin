import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs-extra';
import { ChildProcess } from 'child_process';
import { RhamtChannel } from '../util/console';
import { ProcessRunner } from './processRunner';

export enum ProviderName {
    Builtin = 'builtin',
    Java = 'java',
    Go = 'go',
    Python = 'python',
    Dotnet = 'dotnet'
}

export interface ProviderCoordinates {
    name: ProviderName;
    binaryPath: string;
    address?: string;
    containerImage?: string;
    containerName?: string;
}

export interface ProviderConfig {
    [key: string]: any;
}

/*
    Allows running external providers
*/
export interface ProviderRunner {
    /* Returns all running providers that were started by the runner */
    providers(): ProviderCoordinates[];
    /* Runs the given provider */
    run(provider: ProviderCoordinates, outputChan: RhamtChannel): Promise<ProviderCoordinates>;
    /* Stops all providers */
    stop(outputChan: RhamtChannel): Promise<void>;
}

interface RunnerState {
    process: ChildProcess,
    coords: ProviderCoordinates
}

/*
    Runs external providers locally on the host
*/
export class LocalProviderRunner implements ProviderRunner {
    private static instance: LocalProviderRunner;

    static StartupTimeout: number = 30000;
    private providerState: Map<ProviderName, RunnerState>;

    private constructor() {
        this.providerState = new Map();
    }

    public static getInstance(): LocalProviderRunner {
        if (!this.instance) {
            this.instance = new LocalProviderRunner();
        }
        return this.instance;
    }

    public providers(): ProviderCoordinates[] {
        return Array.from(this.providerState.entries()).map(([prov, state]) => state.coords)
    }

    public async run(provider: ProviderCoordinates, outputChan: RhamtChannel): Promise<ProviderCoordinates> {
        const port = await LocalProviderRunner.getFreePort();
        const startedProvider = { ...provider, address: `localhost:${port}`};
        return new Promise<ProviderCoordinates>(async (resolve, reject) => {
            try {
                await ProcessRunner.run(provider.binaryPath, ['--port', port, '--name', provider.name], 6000, {
                    cwd: "/Users/sraghuna/local_dev/kai-vscode-plugin/logs",
                    detached: true,
                    env: {
                        "JAVA_HOME":"/usr/local/Cellar/openjdk@17/17.0.12/libexec/openjdk.jdk/Contents/Home",
                        "PATH": "/usr/local/bin/"
                    },
                }, null, (msg: string) => outputChan.print(msg), () => {
                    this.providerState.delete(provider.name);
                }).then(proc => {
                    this.providerState.set(provider.name, {
                        coords: startedProvider,
                        process: proc,
                    })
                });
                resolve(startedProvider);
            } catch(e) {
                reject(`failed to start provider ${provider.name} - ${e}`);
            }
        });
    }

    public async stop(outputChan: RhamtChannel): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.providerState.forEach((handle) => {
                handle.process.kill();
            });
            outputChan.print('stopped all providers')
            this.providerState = new Map();
            resolve();
        })
    }

    private static async getFreePort(): Promise<string> {
        return new Promise(res => {
            const srv = net.createServer();
            srv.listen(0, () => {
                const port: number = srv.address().port
                srv.close((err) => res(port.toString()))
            });
        })
    }
}

export const getProviderConfigs = (providers: ProviderCoordinates[], libPath: string, inputLocations: string[], relativePath ?: string): ProviderConfig[] => {
    const defaultProviders: ProviderConfig[] = [{
        'name': 'builtin',
        'initConfig': (inputLocations || []).map((val) => ({ 'location': val })),
    }];
    const externalProviders = providers.map((item) => {
        switch (item.name) {
            case ProviderName.Java:
                return {
                    'name': 'java',
                    'address': item.address,
                    'initConfig': (inputLocations || []).map((val) => ({
                        'location': val,
                        'providerSpecificConfig': {
                            'lspServerName': 'java',
                            'lspServerPath': path.join(libPath, 'java', 'jdtls', 'bin', 'jdtls'),
                            'depOpenSourceLabelsFile': path.join(libPath, 'java', 'maven.index'),
                            'includedPaths': [ relativePath,
                            ],
                            'bundles': path.join(libPath, 'java', 'jdtls', 'java-analyzer-bundle',
                                'java-analyzer-bundle.core', 'target', 'java-analyzer-bundle.core-1.0.0-SNAPSHOT.jar'),
                        }
                    }))
                };
            default:
                return undefined;
        }
    }).filter(provider => provider !== undefined);
    return [...defaultProviders, ...externalProviders];
}


export const providerBinaryPath = (p: ProviderName, libPath: string): string => {
    switch (p) {
        case ProviderName.Java: return path.join(libPath, 'java', 'java-external-provider')
    }
    return ''
}

export const writeProviderSettingsFile = (basePath: string, configs: ProviderConfig[]): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
        try {
            const location = path.resolve(basePath);
            fs.exists(location, async exists => {
                if (exists) {
                    try {
                        const data = JSON.stringify(configs, null, 4);
                        fs.writeFile(path.join(location, 'provider_settings.json'),
                            data, (err) => {
                                if (err) {
                                    return reject(err);
                                }
                                resolve();
                            })
                    } catch (e) {
                        return reject(`Error loading analyzer results for configuration at ${location} - ${e}`);
                    }
                } else {
                    return reject(`Output location does not exist - ${location}`);
                }
            });
        } catch (e) {
            return Promise.reject(`Error writing provider settings file - ${e}`);
        }
    });
}