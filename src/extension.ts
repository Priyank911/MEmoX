import * as vscode from 'vscode';
import { ChatPanel } from './chat/ChatPanel';
import { AuthService, AuthState } from './auth/AuthService';
import { SignInButton } from './auth/SignInButton';
import { AuthWebview } from './auth/AuthWebview';
import * as path from 'path';
import { Conversation } from './chat/ChatHistoryManager';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getNonce } from './utils';
import fetch from 'node-fetch';
import { RAGManager } from './rag/ragManager';
import { pipeline } from '@xenova/transformers';

// Load environment variables from .env file
try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (error) {
    console.log('MEmoX: .env file not found or invalid. Using settings only.');
}

const execAsync = promisify(exec);

interface CodeContext {
    file: string;
    code: string;
    language: string;
}

interface CodeElement {
    type: 'function' | 'class';
    name: string;
    signature?: string;
    startLine: number;
    endLine: number;
    code: string;
    comments?: string[];
    parameters?: string[];
    returnType?: string;
}

interface RepoIndex {
    [filePath: string]: {
        language: string;
        elements: CodeElement[];
        imports?: string[];
        fileContent: string;
    };
}

let ollamaStatus = {
    isInstalled: false,
    isDownloaded: false,
    modelName: '',
    performance: 'low' as 'high' | 'low',
    mode: 'local' as 'local' | 'cloud',
};

let repoIndex: RepoIndex = {};

let ragManager: RAGManager;

// Get API key and endpoint from environment variables with fallbacks
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_API_URL = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions';

let localLLM: any = null;
let localLLMLoading: Promise<any> | null = null;

export async function activate(context: vscode.ExtensionContext) {
    console.log('MEmoX is now active!');

    // Initialize RAG system and index workspace
    try {
        ragManager = new RAGManager(context);
        await ragManager.initialize();
        
        // Start indexing processes (don't await them to avoid blocking extension activation)
        // We'll use promises to track their completion
        const indexingPromises = [
            ragManager.indexWorkspace(),
            scanWorkspace() // Keep this for now to maintain repoIndex
        ];
        
        // Log when indexing completes
        Promise.all(indexingPromises).then(() => {
            console.log('Memox RAG system initialized and workspace indexing completed.');
        }).catch(error => {
            console.error('Error during workspace indexing:', error);
        });
    } catch (error) {
        console.error('Failed to initialize RAG system:', error);
        // Create empty RAG manager to prevent null references
        ragManager = new RAGManager(context);
    }

    await checkOllamaStatus();    // Initialize auth components
    const authService = AuthService.getInstance(context);
    const signInButton = SignInButton.getInstance(context, authService);
    
    // Create and register the chat panel with direct references to our AI handlers
    const chatPanel = new ChatPanel(context, {
        handleUserMessage: handleUserMessage,
        ragManager: ragManager
    });
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('memoxChatView', chatPanel)
    );
    
    // Register commands
    let startChatCommand = vscode.commands.registerCommand('memox.startChat', () => {
        // Only show the chat if authenticated, otherwise prompt to sign in
        if (authService.isAuthenticated()) {
            chatPanel.reveal();
        } else {
            const authWebview = new AuthWebview(context, authService);
            authWebview.show();
        }
    });    // Register auth commands
    let signInCommand = vscode.commands.registerCommand('memox.signIn', () => {
        signInButton.signIn();
    });

    let signOutCommand = vscode.commands.registerCommand('memox.signOut', () => {
        signInButton.signOut();
    });      // Command to manually enter authentication code from GitHub
    let manualAuthCommand = vscode.commands.registerCommand('memox.manualAuth', async () => {
        const codeInput = await vscode.window.showInputBox({
            prompt: 'Enter the GitHub authorization code',
            placeHolder: 'Paste the code from GitHub here...',
            ignoreFocusOut: true,
            validateInput: (value: string) => {
                return value && value.trim().length > 0 ? null : 'Authorization code cannot be empty';
            }
        });
        
        if (codeInput) {
            // Skip state validation for manual entry
            const success = await authService.exchangeManualCode(codeInput);
            
            if (success) {
                        vscode.window.showInformationMessage('MEmoX: Authentication successful!');
                        vscode.commands.executeCommand('memox.startChat');
                    } else {
                        vscode.window.showErrorMessage('MEmoX: Authentication failed. Please try again.');
            }
        }
    });
    
    // Manual authentication command for users to complete auth if automatic redirect fails
    let manualAuthenticationCommand = vscode.commands.registerCommand('memox.manualAuthentication', async () => {
        const code = await vscode.window.showInputBox({
            prompt: 'Enter the GitHub authorization code from your browser',
            placeHolder: 'GitHub authorization code',
            ignoreFocusOut: true
        });
        
        if (code) {
            // Use a default state or ask for it if needed
            const state = authService.getStoredStateParam() || '';
            const success = await authService.exchangeGitHubCodeForToken(code, state);
            
            if (success) {
                vscode.window.showInformationMessage('MEmoX: Authentication successful!');
                vscode.commands.executeCommand('memox.startChat');
            }
        }
    });
    
    // Test URI handler command
    let testUriCommand = vscode.commands.registerCommand('memox.testUriHandler', async () => {
        const testUri = vscode.Uri.parse('vscode://memox/callback?code=test_code&state=test_state');
        vscode.env.openExternal(testUri).then(success => {
            vscode.window.showInformationMessage(`MEmoX: URI handler test ${success ? 'succeeded' : 'failed'}`);
        });
    });      // Register URI handler for GitHub OAuth callback
    const uriHandler = vscode.window.registerUriHandler({
        handleUri: async (uri: vscode.Uri) => {
            console.log('MEmoX: Received URI callback:', uri.toString());
            
            if (uri.path === '/callback') {
                // Parse the query parameters
                const queryParams = new URLSearchParams(uri.query);
                const code = queryParams.get('code');
                const state = queryParams.get('state');
                
                console.log('MEmoX: Callback received with code:', code ? 'Present' : 'Missing', 'and state:', state ? 'Present' : 'Missing');
                
                if (code && state) {
                    // Exchange code for token
                    const success = await authService.exchangeGitHubCodeForToken(code, state);
                    
                    if (success) {
                        // Open chat panel after successful authentication
                        vscode.commands.executeCommand('memox.startChat');
                        vscode.window.showInformationMessage('MEmoX: Successfully authenticated with GitHub!');
                    } else {
                        // Show specific error message and suggest manual entry
                        vscode.window.showErrorMessage('MEmoX: GitHub authentication failed. Would you like to try manual code entry?', 'Yes', 'No')
                            .then(selection => {
                                if (selection === 'Yes') {
                                    vscode.commands.executeCommand('memox.manualAuth');
                                }
                            });
                    }
                } else if (queryParams.get('error')) {
                    console.error('MEmoX: GitHub auth error:', queryParams.get('error'), queryParams.get('error_description'));
                    vscode.window.showErrorMessage(`MEmoX: Authentication error: ${queryParams.get('error_description') || 'Unknown error'}`);
                } else {
                    // Missing parameters error
                    console.error('MEmoX: Invalid callback - missing code or state parameter');
                    vscode.window.showErrorMessage('MEmoX: Authentication failed. Invalid callback parameters.');
                }
            } else {
                console.warn('MEmoX: Received URI with unexpected path:', uri.path);
            }
        }
    });    // Subscribe to auth state changes to show chat automatically when authenticated
    authService.onStateChanged((state) => {
        if (state === AuthState.SignedIn) {
            vscode.commands.executeCommand('memox.startChat');
        }
    });

    // View Chat History command for task bar
    let viewChatHistoryCommand = vscode.commands.registerCommand('memox.viewChatHistory', async () => {
        const historyManager = require('./chat/ChatHistoryManager').ChatHistoryManager.getInstance(context);
        const chatPanelInstance = chatPanel;
        const conversations: Conversation[] = historyManager.getConversations().slice(0, 6);
        if (conversations.length === 0) {
            vscode.window.showInformationMessage('No chat history found.');
            return;
        }
        const pick = await vscode.window.showQuickPick<
            { label: string; description: string; id: string }
        >(
            conversations.map((conv: Conversation) => ({
                label: conv.title,
                description: new Date(conv.updatedAt).toLocaleString(),
                id: conv.id
            })),
            {
                placeHolder: 'Select a conversation to load',
            }
        );
        if (pick && pick.id) {
            // Load the selected conversation in the chat panel
            chatPanelInstance.reveal();
            setTimeout(() => {
                chatPanelInstance['_loadConversation'](pick.id);
            }, 300);
        }
    });    let newChatCommand = vscode.commands.registerCommand('memox.newChat', () => {
        chatPanel.reveal();
        setTimeout(() => {
            // @ts-ignore: Accessing private method for command
            chatPanel['_createNewConversation']();
        }, 300);    });
    
    // Register the new openChat command for the advanced chat interface
    let openChatCommand = vscode.commands.registerCommand('memox.openChat', () => {
        let chatPanel: vscode.WebviewPanel | undefined;
        
        if (chatPanel) {
            chatPanel.reveal();
            return;
        }

        chatPanel = vscode.window.createWebviewPanel(
            'memoxChat',
            'Memox Chat',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'media'),
                    vscode.Uri.joinPath(context.extensionUri, 'dist')
                ]
            }
        );

        chatPanel.webview.html = getWebviewContent(chatPanel.webview, context.extensionUri);

        chatPanel.onDidDispose(() => {
            chatPanel = undefined;
        });

        chatPanel.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'sendMessage':
                    try {
                        // Get relevant context from RAG system
                        const context = await ragManager.getRelevantContext(message.message);
                        const response = await handleUserMessage({
                            content: message.message,
                            timestamp: Date.now(),
                            context
                        });
                        chatPanel?.webview.postMessage({
                            command: 'addMessage',
                            message: {
                                type: 'assistant',
                                content: response.content,
                                timestamp: Date.now()
                            }
                        });
                    } catch (error) {
                        chatPanel?.webview.postMessage({
                            command: 'error',
                            error: error instanceof Error ? error.message : 'An error occurred'
                        });
                    }
                    break;
                case 'sendCloudMessage':
                    try {
                        const response = await handleCloudMessage(message.message);
                        chatPanel?.webview.postMessage({
                            command: 'cloudResponse',
                            message: {
                                type: 'assistant',
                                content: response.content,
                                timestamp: Date.now()
                            }
                        });
                    } catch (error) {
                        chatPanel?.webview.postMessage({
                            command: 'error',
                            error: error instanceof Error ? error.message : 'Cloud error'
                        });
                    }
                    break;
                case 'checkOllamaStatus':
                    await checkOllamaStatus();
                    chatPanel?.webview.postMessage({
                        command: 'ollamaStatus',
                        status: ollamaStatus
                    });
                    break;
            }
        });
    });    // Make functions available for use in ChatPanel
    context.subscriptions.push(startChatCommand, signInCommand, signOutCommand, manualAuthCommand, manualAuthenticationCommand, testUriCommand, uriHandler, viewChatHistoryCommand, newChatCommand, openChatCommand);
    
    // Export functions and objects for use in other parts of the extension
    return {
        handleUserMessage,
        ragManager,
        ollamaStatus,
        repoIndex
    };
}

export function deactivate() {
    // Cleanup resources
}

// Keep the old scanWorkspace function for now, but ensure it's not called on activation
// We can potentially remove it later if it's no longer needed.
async function scanWorkspace() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    repoIndex = {}; // Clear previous index

    for (const folder of workspaceFolders) {
        const files = await vscode.workspace.findFiles(
            '**/*',
            '**/node_modules/**,**/.git/**,**/dist/**' // Exclude common directories
        );

        for (const file of files) {
            const relativePath = path.relative(folder.uri.fsPath, file.fsPath);
            const fileExtension = path.extname(file.fsPath).toLowerCase();
            const language = fileExtension.slice(1);

            // Original file filtering, which we want to avoid in the new RAG system
            // if (!['js', 'ts', 'py', 'java', 'c', 'cpp'].includes(language)) {
            //     continue;
            // }

            try {
                const content = await vscode.workspace.fs.readFile(file);
                const fileContent = Buffer.from(content).toString('utf-8');
                const lines = fileContent.split('\n');
                const elements: CodeElement[] = [];
                let currentElement: CodeElement | null = null;
                let currentComments: string[] = [];
                let imports: string[] = [];

                // Extract imports/dependencies
                lines.forEach(line => {
                    const importMatch = line.match(/^(?:import|from|require|using)\s+(.+)/);
                    if (importMatch) {
                        imports.push(importMatch[1].trim());
                    }
                });

                // Process each line for code elements
                lines.forEach((line, index) => {
                    const lineNumber = index + 1;
                    let match;

                    // Collect comments
                    const commentMatch = line.match(/^\s*(?:\/\/|\#|\/\*|\*)\s*(.+)/);
                    if (commentMatch) {
                        currentComments.push(commentMatch[1].trim());
                        return;
                    }

                    // Python functions
                    match = line.match(/^\s*def\s+(\w+)\s*\((.*?)\)(?:\s*->\s*(\w+))?/);
                    if (match) {
                        if (currentElement) {
                            const element = currentElement as CodeElement;
                            element.endLine = lineNumber - 1;
                            element.code = lines.slice(element.startLine - 1, element.endLine).join('\n');
                            element.comments = currentComments;
                            elements.push(element);
                        }
                        currentElement = {
                            type: 'function',
                            name: match[1],
                            signature: match[0],
                            startLine: lineNumber,
                            endLine: lineNumber,
                            code: '',
                            parameters: match[2].split(',').map(p => p.trim()),
                            returnType: match[3],
                            comments: []
                        };
                        currentComments = [];
                        return;
                    }

                    // Python classes
                    match = line.match(/^\s*class\s+(\w+)\s*(?:\((.*?)\))?:/);
                    if (match) {
                        if (currentElement) {
                            const element = currentElement as CodeElement;
                            element.endLine = lineNumber - 1;
                            element.code = lines.slice(element.startLine - 1, element.endLine).join('\n');
                            element.comments = currentComments;
                            elements.push(element);
                        }
                        currentElement = {
                            type: 'class',
                            name: match[1],
                            signature: match[0],
                            startLine: lineNumber,
                            endLine: lineNumber,
                            code: '',
                            comments: []
                        };
                        currentComments = [];
                        return;
                    }

                    // JS/TS functions
                    match = line.match(/^\s*(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)(?:\s*:\s*(\w+))?\s*=>)/);
                    if (match) {
                        if (currentElement) {
                            const element = currentElement as CodeElement;
                            element.endLine = lineNumber - 1;
                            element.code = lines.slice(element.startLine - 1, element.endLine).join('\n');
                            element.comments = currentComments;
                            elements.push(element);
                        }
                        const name = match[1] || match[2];
                        if (name) {
                            currentElement = {
                                type: 'function',
                                name: name,
                                signature: match[0],
                                startLine: lineNumber,
                                endLine: lineNumber,
                                code: '',
                                parameters: match[3].split(',').map(p => p.trim()),
                                returnType: match[4],
                                comments: []
                            };
                            currentComments = [];
                        }
                        return;
                    }

                    // JS/TS classes
                    match = line.match(/^\s*class\s+(\w+)(?:\s+extends\s+(\w+))?/);
                    if (match) {
                        if (currentElement) {
                            const element = currentElement as CodeElement;
                            element.endLine = lineNumber - 1;
                            element.code = lines.slice(element.startLine - 1, element.endLine).join('\n');
                            element.comments = currentComments;
                            elements.push(element);
                        }
                        currentElement = {
                            type: 'class',
                            name: match[1],
                            signature: match[0],
                            startLine: lineNumber,
                            endLine: lineNumber,
                            code: '',
                            comments: []
                        };
                        currentComments = [];
                        return;
                    }
                });

                // Add the last element if exists
                if (currentElement) {
                    const element = currentElement as CodeElement;
                    element.endLine = lines.length;
                    element.code = lines.slice(element.startLine - 1, element.endLine).join('\n');
                    element.comments = currentComments;
                    elements.push(element);
                }

                repoIndex[relativePath] = {
                    language,
                    elements,
                    imports,
                    fileContent
                };
            } catch (e) {
                console.error(`Memox: Error reading file ${relativePath}: ${e}`);
            }
        }
    }

    console.log('Memox: Workspace scanned. Index built with elements.', Object.keys(repoIndex).length, 'files indexed.');
}

async function checkOllamaStatus() {
    try {
        await execAsync('ollama --version');
        ollamaStatus.isInstalled = true;
        const { stdout } = await execAsync('ollama list');
        const hasCodeLLaMA = stdout.includes('codellama');
        ollamaStatus.isDownloaded = hasCodeLLaMA;
        ollamaStatus.modelName = hasCodeLLaMA ? 'CodeLLaMA' : '';
        const totalMemory = require('os').totalmem();
        ollamaStatus.performance = totalMemory > 16 * 1024 * 1024 * 1024 ? 'high' : 'low';
        ollamaStatus.mode = hasCodeLLaMA ? 'local' : 'cloud';
    } catch (error) {
        ollamaStatus.isInstalled = false;
        ollamaStatus.isDownloaded = false;
        ollamaStatus.mode = 'cloud';
    }
}

function tokenize(str: string) {
    return str.split(/\W+/).filter(Boolean);
}

function tokenOverlap(a: string, b: string) {
    const aTokens = new Set(tokenize(a));
    const bTokens = new Set(tokenize(b));
    let overlap = 0;
    for (const t of aTokens) if (bTokens.has(t)) overlap++;
    return overlap / Math.max(aTokens.size, 1);
}

async function handleUserMessage(message: { content: string; timestamp: number; context?: string }) {
    try {
        // Get relevant context from RAG if not already provided
        let context = message.context;
        if (!context && ragManager) {
            try {
                console.log('MEmoX: Getting context from RAG manager for query:', message.content);
                context = await ragManager.getRelevantContext(message.content);
                console.log('MEmoX: RAG context retrieval successful:', 
                    context ? `${context.length} characters` : 'No context found');
            } catch (ragError) {
                console.error('MEmoX: Error getting context from RAG manager:', ragError);
                // Continue without context if RAG fails
            }
        }

        // Check if we have local LLM capabilities
        const useLocalLLM = ollamaStatus.isInstalled && ollamaStatus.isDownloaded;
        console.log('MEmoX: Using local LLM?', useLocalLLM ? 'Yes' : 'No');
        
        if (useLocalLLM) {
            try {
                // TODO: Add local Ollama LLM integration here
                // This would need to call Ollama API directly
                // For now, fall back to cloud API
                console.log('MEmoX: Local LLM support is in development, falling back to cloud API');
                const cloudResponse = await handleCloudMessage({
                    content: message.content,
                    timestamp: Date.now()
                });
                return cloudResponse;
            } catch (ollamaError) {
                console.error('MEmoX: Error with Ollama:', ollamaError);
                // Fall back to cloud
            }
        }
        
        // Try using embedded small LLM for simple answers
        try {
            // If there's relevant code context or the query is complex, skip the small model
            const isSimpleQuery = message.content.length < 100 && !message.content.includes('code') && 
                !message.content.includes('function') && !message.content.includes('class');
            
            if (!context && isSimpleQuery && !localLLMLoading) {
                console.log('MEmoX: Attempting to use small embedded LLM for simple query');
                // Initialize LLM if not already loading
                if (!localLLMLoading) {
                    console.log('MEmoX: Initializing small embedded LLM...');
                    localLLMLoading = pipeline('text2text-generation', 'Xenova/flan-t5-small', { quantized: true });
                    console.log('MEmoX: Small LLM loading initiated');
                }
                
                try {
                    // Wait for LLM to load with a timeout
                    const timeoutPromise = new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('LLM loading timeout')), 5000));
                    localLLM = await Promise.race([localLLMLoading, timeoutPromise]);
                    
                    console.log('MEmoX: Small embedded LLM loaded, generating response...');
                    const output = await localLLM(message.content, { max_new_tokens: 256 });
                    const answer = Array.isArray(output) && output[0]?.generated_text 
                        ? output[0].generated_text 
                        : (output?.generated_text || '');
                        
                    if (answer && answer.trim().length > 20) {
                        console.log('MEmoX: Small embedded LLM generated response');
                        return { content: answer.trim(), codeContext: context };
                    } else {
                        console.log('MEmoX: Small embedded LLM response too short, falling back to cloud');
                    }
                } catch (timeoutErr) {
                    console.log('MEmoX: Small embedded LLM loading timed out, falling back to cloud API');
                }
            }
            
            // Fallback to cloud API for all other cases
            console.log('MEmoX: Using cloud API for response');
            const cloudResponse = await handleCloudMessage({
                content: message.content,
                timestamp: Date.now()
            });
            return cloudResponse;
        } catch (err) {
            console.error('MEmoX: LLM error:', err);
            
            // Fallback to cloud API
            try {
                console.log('MEmoX: Error with embedded LLM, falling back to cloud API');
                const cloudResponse = await handleCloudMessage({
                    content: message.content,
                    timestamp: Date.now()
                });
                return cloudResponse;
            } catch (cloudErr) {
                console.error('MEmoX: Cloud fallback also failed:', cloudErr);
                return { 
                    content: 'Sorry, I encountered an issue while processing your question. The AI models are currently unavailable. Please try again later.',
                    codeContext: context 
                };
            }
        }
    } catch (error) {
        console.error('MEmoX: Unexpected error in handleUserMessage:', error);
        return {
            content: 'An unexpected error occurred. Please try again later.',
            codeContext: message.context
        };
    }
}

async function handleCloudMessage(message: { content: string; timestamp: number }) {
    const apiKey = OPENAI_API_KEY;
    
    // Check if API key is available
    if (!apiKey) {
        console.error('MEmoX: OpenAI API key not found. Please add it to .env file or settings.');
        return { 
            content: 'Cloud AI service is not configured. Please add your OpenAI API key to the .env file or settings.'
        };
    }
    
    try {
        // Get repository overview (simplified and more focused)
        let repoContext = '';
        if (Object.keys(repoIndex).length > 0) {
            // Count files by language for a higher-level overview
            const languageCounts: Record<string, number> = {};
            const filesByLanguage: Record<string, string[]> = {};
            
            for (const filePath in repoIndex) {
                const lang = repoIndex[filePath].language;
                languageCounts[lang] = (languageCounts[lang] || 0) + 1;
                
                if (!filesByLanguage[lang]) {
                    filesByLanguage[lang] = [];
                }
                filesByLanguage[lang].push(filePath);
            }
            
            repoContext = 'Repository Overview:\n';
            for (const lang in languageCounts) {
                repoContext += `- ${lang}: ${languageCounts[lang]} files\n`;
            }
            
            // Include a sample of key files for each language (max 5 per language)
            repoContext += '\nKey Files By Language:\n';
            for (const lang in filesByLanguage) {
                repoContext += `\n${lang.toUpperCase()} FILES:\n`;
                const sampleFiles = filesByLanguage[lang].slice(0, 5);
                for (const file of sampleFiles) {
                    repoContext += `- ${file}\n`;
                }
                if (filesByLanguage[lang].length > 5) {
                    repoContext += `  (and ${filesByLanguage[lang].length - 5} more)\n`;
                }
            }
        } else {
            repoContext = 'No repository files have been indexed yet.';
        }

        // Get relevant context from RAG system with error handling
        let ragContext = '';
        try {
            ragContext = await ragManager.getRelevantContext(message.content);
            console.log('MEmoX: Got RAG context for OpenAI query', 
                ragContext ? 'successfully' : 'but context was empty');
        } catch (ragError) {
            console.error('MEmoX: Error getting RAG context for OpenAI query:', ragError);
            ragContext = 'Error retrieving code context: ' + (ragError instanceof Error ? ragError.message : String(ragError));
        }
        
        // Analyze user query to determine if we need code generation or explanation
        const isCodeGeneration = /create|generate|write|implement|build|make a/i.test(message.content);
        
        // Build the system message based on query type
        const systemMessage = isCodeGeneration 
            ? `You are an expert code assistant for VS Code. You specialize in writing clean, efficient code with helpful comments. Use the provided repository context to understand the codebase structure, and the specific code snippets to inform your code generation. When writing code, follow best practices for the language in question.`
            : `You are an expert code assistant for VS Code. You specialize in explaining code, debugging issues, and providing technical guidance. Use the provided repository context to understand the codebase structure, and focus on the specific code snippets when answering the user's question.`;
        
        // Build the user message with both repository overview and RAG context
        const userMessage = `${repoContext}

RELEVANT CODE CONTEXT:
${ragContext || 'No specific code context found.'}

USER QUESTION:
${message.content}

${isCodeGeneration 
    ? 'Please generate code that follows the style and patterns used in the existing codebase. Add helpful comments to explain your implementation.'
    : 'Please provide a detailed answer based on the repository structure and code context above. If the answer is not in the context, say so. Format your response in a clear and organized way.'}`;

        // Make the API request with both system and user messages for better context handling
        const response = await fetch(OPENAI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [
                    { role: 'system', content: systemMessage },
                    { role: 'user', content: userMessage }
                ],
                max_tokens: 1500,
                temperature: isCodeGeneration ? 0.2 : 0.7, // Lower temperature for code generation
                top_p: 0.95
            })
        });

        // Handle API response
        if (!response.ok) {
            const errorText = await response.text();
            console.error('MEmoX: OpenAI API error:', response.status, errorText);
            return { 
                content: `I encountered an error connecting to the AI service (HTTP ${response.status}). Please try again later.`
            };
        }

        const data = await response.json() as {
            choices?: { message?: { content?: string } }[];
            error?: { message?: string };
        };
        
        // Check for API-level errors
        if (data.error) {
            console.error('MEmoX: OpenAI API returned error:', data.error);
            return { 
                content: `The AI service returned an error: ${data.error.message || 'Unknown error'}. Please try again later.`
            };
        }
        
        const assistantResponse = data.choices?.[0]?.message?.content || 'No response content was returned from the AI service.';
        return { content: assistantResponse };
    } catch (error) {
        console.error('MEmoX: Unexpected error in handleCloudMessage:', error);
        return { 
            content: 'I encountered an unexpected error while processing your request. Please try again later.' 
        };
    }
}

async function findSimilarCode(code: string): Promise<CodeContext | undefined> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return undefined;
    const searchResults = await vscode.workspace.findFiles(
        '**/*.{js,ts,py,java,c,cpp}',
        '**/node_modules/**'
    );
    let best: { score: number; ctx: CodeContext } | undefined;
    for (const file of searchResults) {
        const content = await vscode.workspace.fs.readFile(file);
        const fileContent = Buffer.from(content).toString('utf-8');
        const score = tokenOverlap(code, fileContent);
        if (!best || score > best.score) {
            best = {
                score,
                ctx: {
                    file: path.relative(workspaceFolders[0].uri.fsPath, file.fsPath),
                    code: fileContent,
                    language: path.extname(file.fsPath).slice(1)
                }
            };
        }
    }
    if (best && best.score > 0.2) return best.ctx;
    return undefined;
}

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'dist', 'webview-ui', 'index.js')
    );
    const styleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'dist', 'webview-ui', 'index.css')
    );
    const nonce = getNonce();
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
        <link href="${styleUri}" rel="stylesheet">
        <title>Memox Chat</title>
    </head>
    <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>`;
}