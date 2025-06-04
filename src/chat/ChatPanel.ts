import * as vscode from 'vscode';
import { AuthService, AuthState } from '../auth/AuthService';
import { ChatHistoryManager, Conversation, ChatMessage } from './ChatHistoryManager';

export class ChatPanel implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _authService: AuthService;
    private _historyManager: ChatHistoryManager;
    private _handleAIMessage: ((message: { content: string; timestamp: number; context?: string }) => Promise<any>) | null = null;
    private _ragManager: any = null;

    constructor(
        private readonly _context: vscode.ExtensionContext,
        aiHandlers?: {
            handleUserMessage?: (message: { content: string; timestamp: number; context?: string }) => Promise<any>,
            ragManager?: any
        }
    ) {
        this._authService = AuthService.getInstance(this._context);
        this._historyManager = ChatHistoryManager.getInstance(this._context);
        
        // Store AI handlers if provided
        if (aiHandlers) {
            this._handleAIMessage = aiHandlers.handleUserMessage || null;
            this._ragManager = aiHandlers.ragManager || null;
        }
        
        // Listen for auth state changes to update UI
        this._authService.onStateChanged(this._handleAuthStateChanged.bind(this));
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._context.extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {                
                case 'sendMessage':
                    await this._handleUserMessage(data.value);
                    break;
                case 'signIn':
                    vscode.commands.executeCommand('memox.signIn');
                    break;
                case 'requestAuthState':
                    console.log('MEmoX Extension: Received request for auth state');
                    this._updateAuthState();
                    break;
                case 'newConversation':
                    this._createNewConversation();
                    break;
                case 'loadConversation':
                    this._loadConversation(data.id);
                    break;
            }
        });

        // Update webview with current auth state
        this._updateAuthState();
        
        // Initialize chat history
        this._updateChatHistory();
    }

    // Handler for authentication state changes
    private _handleAuthStateChanged(state: AuthState): void {
        this._updateAuthState();
    }

    // Update the webview with current authentication state
    private _updateAuthState(): void {
        if (this._view) {
            const isAuthenticated = this._authService.isAuthenticated();
            const authState = this._authService.getState();
            
            this._view.webview.postMessage({
                type: 'authUpdate',
                isAuthenticated,
                authState
            });
        }
    }    public reveal() {
        if (this._view) {
            this._view.show(true);
            // Explicitly update auth state when the panel is revealed
            this._updateAuthState();
        } else {
            // If the view isn't resolved yet, execute the command that will create it
            vscode.commands.executeCommand('memox-sidebar.focus');
        }
    }
    
    private async _handleUserMessage(message: string) {
        if (!this._view) {
            return;
        }

        // Check if user is authenticated
        if (!this._authService.isAuthenticated()) {
            this._view.webview.postMessage({
                type: 'addResponse',
                value: "⚠️ Please sign in to use MEmoX. Click the 'Sign In' button below.",
                requiresAuth: true
            });
            return;
        }

        // Store user message in chat history
        this._historyManager.addMessage(message, true);
        
        try {
            // Check if we have direct access to the AI handlers first
            if (this._handleAIMessage) {
                console.log('MEmoX ChatPanel: Using directly provided handleUserMessage function');
                
                // Get relevant context from RAG system if available
                let context = '';
                if (this._ragManager) {
                    try {
                        context = await this._ragManager.getRelevantContext(message);
                        console.log('MEmoX ChatPanel: Got context from directly provided RAG manager');
                    } catch (error) {
                        console.error('Error getting RAG context:', error);
                        // Continue without context
                    }
                }
                
                // Use the directly provided handleUserMessage function
                try {
                    const result = await this._handleAIMessage({
                        content: message,
                        timestamp: Date.now(),
                        context
                    });
                    
                    console.log('MEmoX ChatPanel: Direct handleUserMessage result', 
                        result ? 'received' : 'null', 
                        result?.content ? 'with content' : 'without content');
                    
                    if (result && result.content) {
                        // Store AI response in chat history
                        this._historyManager.addMessage(result.content, false);
                        
                        // Send response back to webview
                        this._view.webview.postMessage({
                            type: 'addResponse',
                            value: result.content
                        });
                        return;
                    }
                } catch (callError) {
                    console.error('MEmoX ChatPanel: Error calling direct handleUserMessage:', callError);
                    // Continue to fallback
                }
            }
            
            // Fallback to extension exports if direct handlers are not available
            console.log('MEmoX ChatPanel: Trying extension exports');
            
            // Try to get the RAG manager from the extension - try both with and without publisher prefix
            let extension = vscode.extensions.getExtension('memox');
            
            // If not found, try with default publisher prefix 
            if (!extension) {
                extension = vscode.extensions.getExtension('memoranet.memox');
                console.log('MEmoX ChatPanel: Trying with publisher prefix', extension ? 'found' : 'not found');
            } else {
                console.log('MEmoX ChatPanel: Extension found with ID memox');
            }
            
            // List all extensions to help debug
            console.log('MEmoX ChatPanel: All extensions:', vscode.extensions.all.map(ext => ext.id).join(', '));
            
            if (extension) {
                const extensionExports = extension.exports;
                console.log('MEmoX ChatPanel: Extension exports', 
                    'handleUserMessage:', !!extensionExports?.handleUserMessage,
                    'ragManager:', !!extensionExports?.ragManager);
                
                if (extensionExports && extensionExports.handleUserMessage) {
                    // Get relevant context from RAG system if available
                    let context = '';
                    if (extensionExports.ragManager) {
                        try {
                            context = await extensionExports.ragManager.getRelevantContext(message);
                            console.log('MEmoX ChatPanel: Got context from RAG manager', context ? 'with content' : 'empty');
                        } catch (error) {
                            console.error('Error getting RAG context:', error);
                            // Continue without context
                        }
                    }
                    
                    // Use the handleUserMessage function from extension.ts
                    console.log('MEmoX ChatPanel: Calling handleUserMessage');
                    try {
                        const result = await extensionExports.handleUserMessage({
                            content: message,
                            timestamp: Date.now(),
                            context
                        });
                        
                        console.log('MEmoX ChatPanel: handleUserMessage result', result ? 'received' : 'null', 
                            result?.content ? 'with content' : 'without content');
                        
                        if (result && result.content) {
                            // Store AI response in chat history
                            this._historyManager.addMessage(result.content, false);
                            
                            // Send response back to webview
                            this._view.webview.postMessage({
                                type: 'addResponse',
                                value: result.content
                            });
                            return;
                        } else {
                            console.log('MEmoX ChatPanel: Invalid result from handleUserMessage');
                        }
                    } catch (callError) {
                        console.error('MEmoX ChatPanel: Error calling handleUserMessage:', callError);
                    }
                }
            }
            
            // Fallback response if all methods fail
            const response = "I'm sorry, but I wasn't able to process your request at this time. The AI system may still be initializing. Please try again in a moment.";
            
            // Store AI response in chat history
            this._historyManager.addMessage(response, false);
            
            // Send response back to webview
            this._view.webview.postMessage({
                type: 'addResponse',
                value: response
            });
        } catch (error) {
            console.error('Error handling message:', error);
            const errorMessage = "An error occurred while processing your request. The AI system might be temporarily unavailable. Please try again in a moment.";
            
            // Store error response in chat history
            this._historyManager.addMessage(errorMessage, false);
            
            // Send error response back to webview
            this._view.webview.postMessage({
                type: 'addResponse',
                value: errorMessage
            });
        }
    }

    // Create a new conversation
    private _createNewConversation(): void {
        this._historyManager.createConversation();
        this._updateChatHistory();
    }

    // Load a specific conversation
    private _loadConversation(id: string): void {
        if (this._historyManager.switchConversation(id)) {
            this._updateChatHistory();
        }
    }

    // Update the chat history UI in the webview
    private _updateChatHistory(): void {
        if (!this._view) {
            return;
        }

        const currentConversation = this._historyManager.getCurrentConversation();
        const conversations = this._historyManager.getConversations();

        this._view.webview.postMessage({
            type: 'updateChatHistory',
            currentConversation,
            conversations: conversations.slice(0, 5) // Only send the last 5
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>MEmoX Chat</title>
                <style>
                :root {
                        /* GitHub Copilot colors */
                        --copilot-primary: #0C7BDC;
                        --copilot-primary-hover: #0E89F5;
                        --copilot-secondary-bg: #1E1E1E;
                        --copilot-user-bubble: #2D2D2D;
                        --copilot-ai-bubble: #171717;
                        --copilot-separator:rgb(35, 123, 255);
                        --copilot-text: #CCCCCC;
                        --copilot-text-muted: #8B8B8B;
                        --copilot-border: #3E3E3E;
                        --copilot-button-hover: #2D2D2D;
                        --copilot-input-bg: #1E1E1E;
                        --copilot-input-border: #3E3E3E;
                        --copilot-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
                        --button-hover-transition: all 0.2s ease;
                    }
                    
                    @keyframes fadeIn { 0% { opacity: 0; transform: translateY(20px); } 100% { opacity: 1; transform: translateY(0); } }
                    @keyframes floatAnimation { 0% { transform: translateY(0px); } 50% { transform: translateY(-4px); } 100% { transform: translateY(0px); } }
                    @keyframes pulseGlow { 0% { opacity: 0.5; transform: scale(0.98); } 50% { opacity: 1; transform: scale(1); } 100% { opacity: 0.5; transform: scale(0.98); } }
                    @keyframes gradientFlow { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
                    @keyframes ripple { 0% { transform: scale(0); opacity: 1; } 100% { transform: scale(4); opacity: 0; } }                    html, body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                        padding: 0;
                        margin: 0;
                        height: 100%;
                        width: 100%;
                        color: var(--copilot-text);
                        background-color: var(--copilot-secondary-bg);
                        font-size: 13px;
                        line-height: 1.5;
                        border-left: 1px solid var(--copilot-border); /* Left border */
                        border-right: 1px solid var(--copilot-border); /* Right border */
                    }
                      body {
                        display: flex;
                        flex-direction: column;
                        overflow: hidden; /* Prevent body scrolling */
                        position: relative;
                        border-left: 1px solid var(--copilot-border); /* Add border to separate from editor */
                    }

                    /* Remove particle effects for a cleaner interface */
                    #particles-container {
                        display: none;
                    }                    .chat-container {
                        display: flex;
                        flex-direction: column;
                        flex: 1;
                        height: 100%;
                        box-sizing: border-box;
                        position: relative;
                        padding: 12px 16px;
                        overflow: hidden; /* Prevent container overflow */
                        border-right: 1px solid var(--copilot-border); /* Right border for separation */
                        box-shadow: inset -1px 0 0 rgba(0, 0, 0, 0.2); /* Subtle inset shadow for depth */
                    }
                    
                    .messages-wrapper {
                        display: flex;
                        flex-direction: column;
                        flex: 1;
                        min-height: 0; /* Critical for nested flex containers to scroll properly */
                        max-height: calc(100% - 120px); /* Adjust based on header and input height */
                        overflow: hidden; /* Contain overflow to ensure scrolling works inside */
                    }.chat-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 12px;
                        padding-bottom: 8px;
                        border-bottom: 1px solid var(--copilot-separator);
                        position: relative;
                        background-color: var(--copilot-secondary-bg);
                    }

                    .current-chat-title {
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        flex: 1;
                        text-align: left;
                        font-size: 12px;
                        color: var(--copilot-text-muted);
                        font-weight: 600;
                    }
                    
                    .chat-actions {
                        display: flex;
                        gap: 8px;
                    }
                    
                    .chat-actions button {
                        background: transparent;
                        color: var(--copilot-text-muted);
                        width: 24px;
                        height: 24px;
                        padding: 0;
                        min-width: 24px;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        border-radius: 3px;
                    }
                    
                    .chat-actions button:hover {
                        background-color: var(--copilot-button-hover);
                        color: var(--copilot-text);
                    }                    .messages {
                        flex: 1;
                        overflow-y: auto !important; /* Force vertical scrolling */
                        margin-bottom: 12px;
                        scrollbar-width: thin;
                        scrollbar-color: rgba(80, 80, 80, 0.5) transparent;
                        padding-right: 4px;
                        height: 100%; /* Ensure it takes full height */
                        max-height: 100%; /* Limit to container height */
                        overflow-x: hidden; /* Prevent horizontal scrolling */
                        display: flex;
                        flex-direction: column;
                    }

                    .messages::-webkit-scrollbar {
                        width: 6px;
                    }

                    .messages::-webkit-scrollbar-track {
                        background: transparent;
                    }

                    .messages::-webkit-scrollbar-thumb {
                        background-color: rgba(80, 80, 80, 0.5);
                        border-radius: 3px;
                    }
                    
                    .messages::-webkit-scrollbar-thumb:hover {
                        background-color: rgba(100, 100, 100, 0.7);
                    }                    .message {
                        margin-bottom: 16px;
                        padding: 10px 12px;
                        border-radius: 6px;
                        max-width: 85%;
                        word-wrap: break-word;
                        font-size: 13px;
                        line-height: 1.5;
                        animation: fadeIn 0.2s ease-out;
                        box-shadow: var(--copilot-shadow);
                        width: fit-content;
                    }
                    
                    .message.user {
                        align-self: flex-end;
                        background-color: var(--copilot-user-bubble);
                        color: var(--copilot-text);
                        border: none;
                        margin-left: auto;
                    }
                    
                    .message.ai {
                        align-self: flex-start;
                        background-color: var(--copilot-ai-bubble);
                        color: var(--copilot-text);
                        border: none;
                        margin-right: auto;
                    }
                    
                    @keyframes fadeIn { 
                        0% { opacity: 0; transform: translateY(8px); } 
                        100% { opacity: 1; transform: translateY(0); } 
                    }/* Style for markdown content within AI messages */
                    .message.ai code {
                        background-color: rgba(255, 255, 255, 0.1);
                        padding: 2px 4px;
                        border-radius: 3px;
                        font-size: 12px;
                        font-family: 'Consolas', 'Courier New', monospace;
                    }

                    .message.ai pre {
                        background-color: #1E1E1E;
                        border: 1px solid #3E3E3E;
                        border-radius: 6px;
                        padding: 8px 12px;
                        overflow-x: auto;
                        margin: 8px 0;
                    }

                    .message.ai pre code {
                        background-color: transparent;
                        padding: 0;
                        border-radius: 0;
                        font-family: 'Consolas', 'Courier New', monospace;
                        white-space: pre;
                    }
                    
                    /* Syntax highlighting for code blocks (like Copilot) */
                    .message.ai .hljs-keyword {
                        color: #569CD6;
                    }
                    
                    .message.ai .hljs-string {
                        color: #CE9178;
                    }
                    
                    .message.ai .hljs-comment {
                        color: #6A9955;
                    }
                    
                    .message.ai .hljs-function {
                        color: #DCDCAA;
                    }
                    
                    .message.ai .hljs-number {
                        color: #B5CEA8;
                    }
                    
                    .message.ai .hljs-type {
                        color: #4EC9B0;
                    }                    .input-container {
                        background: var(--copilot-input-bg);
                        border: 1px solid var(--copilot-input-border);
                        border-radius: 8px;
                        padding: 0;
                        margin-top: 8px;
                        display: flex;
                        align-items: flex-end;
                        overflow: visible;
                        position: relative;
                        transition: border-color 0.2s;
                        max-height: 200px;
                        box-shadow: 0 0 0 1px var(--copilot-input-border);
                    }
                    
                    .input-container:focus-within {
                        border-color: var(--copilot-primary);
                        box-shadow: 0 0 0 1px var(--copilot-primary);
                    }

                    textarea {
                        background: transparent;
                        color: var(--copilot-text);
                        border: none;
                        outline: none;
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', sans-serif;
                        font-size: 13px;
                        flex: 1;
                        width: 100%;
                        box-sizing: border-box;
                        padding: 8px 12px;
                        min-height: 38px;
                        max-height: 180px;
                        resize: none;
                        overflow-y: auto;
                        line-height: 1.4;
                        margin: 0;
                    }                    textarea::placeholder {
                        color: var(--copilot-text-muted);
                    }
                    
                    textarea::-webkit-scrollbar {
                        width: 6px;
                    }

                    textarea::-webkit-scrollbar-track {
                        background: transparent;
                    }

                    textarea::-webkit-scrollbar-thumb {
                        background-color: rgba(80, 80, 80, 0.5);
                        border-radius: 3px;
                    }
                    
                    textarea::-webkit-scrollbar-thumb:hover {
                        background-color: rgba(100, 100, 100, 0.7);
                    }button {
                        background-color: transparent;
                        color: var(--copilot-primary);
                        font-weight: 500;
                        border: none;
                        padding: 0 12px;
                        height: 32px;
                        font-size: 13px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        box-shadow: none;
                        transition: background-color 0.2s, opacity 0.2s;
                        cursor: pointer;
                        min-width: 32px;
                        border-radius: 4px;
                        margin: 3px 3px 3px 0;
                    }
                    
                    button .ripple {
                        display: none;
                    }

                    button:hover {
                        background-color: rgba(12, 123, 220, 0.1);
                    }
                      button#sendButton {
                        width: 32px;
                        height: 32px;
                        padding: 0;
                    }
                    
                    button:disabled {
                        opacity: 0.5;
                        cursor: not-allowed;
                    }
                    
                    .input-controls {
                        display: flex;
                        align-items: center;
                        margin-right: 4px;
                    }
                    
                    .char-count {
                        font-size: 11px;
                        color: var(--copilot-text-muted);
                        margin-right: 8px;
                        user-select: none;
                    }
                    
                    .char-count.warning {
                        color: #E9A700;
                    }
                    
                    button#signInButton {
                        background-color: var(--copilot-primary);
                        color: white;
                        border-radius: 4px;
                    }
                    
                    button#signInButton:hover {
                        background-color: var(--copilot-primary-hover);
                    }
                    
                    button:active {
                        opacity: 0.9;
                    }                    .auth-banner {
                        padding: 16px;
                        margin-bottom: 16px;
                        background-color: var(--copilot-ai-bubble);
                        border: 1px solid var(--copilot-border);
                        border-radius: 6px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        text-align: center;
                        box-shadow: var(--copilot-shadow);
                    }

                    .auth-banner p {
                        margin: 0 0 12px 0;
                        color: var(--copilot-text);
                        font-size: 13px;
                        line-height: 1.5;
                    }
                    
                    .auth-banner p:last-of-type {
                        margin-bottom: 16px;
                        color: var(--copilot-text-muted);
                        font-size: 12px;
                    }

                    .auth-banner button {
                        background-color: var(--copilot-primary);
                        color: white;
                        border: none;
                        padding: 8px 16px;
                        border-radius: 4px;
                        font-size: 13px;
                        font-weight: 500;
                        transition: background-color 0.2s;
                        height: auto;
                        width: auto;
                    }
                    
                    .auth-banner button:hover {
                        background-color: var(--copilot-primary-hover);
                    }

                    .hidden {
                        display: none;
                    }                    .loading {
                        color: var(--copilot-text-muted);
                        font-style: italic;
                        margin-bottom: 16px;
                        padding: 10px 12px;
                        font-size: 13px;
                        animation: pulse 1.5s infinite ease-in-out;
                        background-color: var(--copilot-ai-bubble);
                        border-radius: 6px;
                        max-width: 85%;
                        align-self: flex-start;
                        display: flex;
                        align-items: center;
                    }
                    
                    .loading::before {
                        content: '';
                        width: 16px;
                        height: 16px;
                        margin-right: 8px;
                        border: 2px solid rgba(204, 204, 204, 0.3);
                        border-radius: 50%;
                        border-top-color: var(--copilot-primary);
                        animation: spin 1s infinite linear;
                        display: inline-block;
                    }
                    
                    @keyframes spin {
                        to { transform: rotate(360deg); }
                    }
                    
                    @keyframes pulse {
                        0% { opacity: 0.7; }
                        50% { opacity: 1; }
                        100% { opacity: 0.7; }
                    }

                    .error-message {
                        background-color: rgba(50, 0, 0, 0.5);
                        border: 1px solid #5a1d1d;
                        color: #f1abab;
                        padding: 10px 12px;
                        border-radius: 6px;
                        margin-bottom: 16px;
                        word-wrap: break-word;
                        font-size: 13px;
                        line-height: 1.5;
                        align-self: stretch;
                    }
                </style>
            </head>
            <body>                <div class="chat-container">
                    <div id="auth-banner" class="auth-banner hidden">
                        <p>Sign in to start using MEmoX AI assistant</p>
                        <p>Your code stays private and secure</p>
                        <button id="signInButton">Sign In with GitHub</button>
                    </div>

                    <div class="chat-header">
                        <span class="current-chat-title">New Conversation</span>
                        <div class="chat-actions">
                            <button id="newChatButton" title="New conversation">
                                <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
                                    <path fill-rule="evenodd" clip-rule="evenodd" d="M8 2a1 1 0 0 1 1 1v4h4a1 1 0 1 1 0 2h-4v4a1 1 0 1 1-2 0V9H3a1 1 0 0 1 0-2h4V3a1 1 0 0 1 1-1z"/>
                                </svg>
                            </button>
                        </div>
                    </div>

                    <div class="messages-wrapper">
                        <div class="messages" id="messages"></div>
                    </div>                    <div class="input-container">
                        <textarea id="messageInput" placeholder="Ask a question..." autocomplete="off" rows="1"></textarea>
                        <div class="input-controls">
                            <span id="charCount" class="char-count hidden">0</span>
                            <button id="sendButton">
                                <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
                                    <path d="M8.06066 3.60355L7.89644 3.76777L12.2501 8.12145H2.75V8.87855H12.2501L7.89645 13.2322L8.06066 13.3964L13.0607 8.39645V8.60355L8.06066 3.60355Z"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>

                <script>                    const vscode = acquireVsCodeApi();
                    const messagesContainer = document.getElementById('messages');
                    const messageInput = document.getElementById('messageInput');
                    const sendButton = document.getElementById('sendButton');
                    const authBanner = document.getElementById('auth-banner');
                    const signInButton = document.getElementById('signInButton');
                    const currentChatTitle = document.querySelector('.current-chat-title');
                    const newChatButton = document.getElementById('newChatButton');
                    const charCount = document.getElementById('charCount');
                    
                    let isAuthenticated = false;
                    let currentConversation = null;
                    let conversations = [];
                    const CHAR_COUNT_THRESHOLD = 100; // Show char count when exceeding this

                    // Create message elements with the right styles
                    function addMessage(content, isUser = false, requiresAuth = false) {
                        const messageDiv = document.createElement('div');
                        messageDiv.classList.add('message');

                        if (requiresAuth) {
                            messageDiv.className = 'error-message'; // Use error-message class
                             messageDiv.textContent = content;                        } else {
                            messageDiv.classList.add(isUser ? 'user' : 'ai');
                            if (!isUser && window.marked) {
                                // Use markdown parsing if available
                                try {
                                    messageDiv.innerHTML = window.marked.parse(content);
                                } catch (error) {
                                    messageDiv.textContent = content;
                                }
                            } else {
                                messageDiv.textContent = content;
                            }
                        }                         messagesContainer.appendChild(messageDiv);
                        
                        // Ensure scrolling to the bottom with a slight delay to account for rendering
                        // Use a longer timeout to ensure all content is rendered properly
                        setTimeout(() => {
                            messagesContainer.scrollTop = messagesContainer.scrollHeight;
                        }, 50);

                        // Show auth banner if response indicates auth is required
                        if (requiresAuth) {
                            authBanner.classList.remove('hidden');
                        }
                    }                    function sendMessage() {
                        const message = messageInput.value.trim();
                        if (message) {
                            // If not authenticated, prompt to sign in
                            if (!isAuthenticated) {
                                authBanner.classList.remove('hidden');
                                return;
                            }

                            addMessage(message, true);
                            // Show loading indicator
                            const loadingDiv = document.createElement('div');
                            loadingDiv.className = 'loading';
                            loadingDiv.textContent = 'Thinking...';
                            messagesContainer.appendChild(loadingDiv);
                            messagesContainer.scrollTop = messagesContainer.scrollHeight;

                            vscode.postMessage({
                                type: 'sendMessage',
                                value: message
                            });                            messageInput.value = '';
                            messageInput.style.height = 'auto';
                            messageInput.focus();

                            // Remove loading indicator when response arrives
                            // This will be handled in the message event listener
                        }
                    }

                    // Update UI based on auth state
                    function updateAuthUI(authenticated) {
                        isAuthenticated = authenticated;

                        if (authenticated) {
                            authBanner.classList.add('hidden');
                            messageInput.disabled = false;
                            sendButton.disabled = false;
                        } else {
                            authBanner.classList.remove('hidden');
                             messageInput.disabled = true; // Disable input when signed out
                             sendButton.disabled = true; // Disable send when signed out
                        }
                    }
                    
                    // Create a new chat
                    function createNewConversation() {
                        vscode.postMessage({
                            type: 'newConversation'
                        });
                    }
                    
                    // Load a conversation into the UI
                    function loadConversation(conversation) {
                        // Clear existing messages
                        messagesContainer.innerHTML = '';
                        
                        // Update conversation title
                        currentConversation = conversation;
                        
                        // Add each message to the UI
                        conversation.messages.forEach(msg => {
                            addMessage(msg.content, msg.isUser);
                        });
                    }                    sendButton.addEventListener('click', sendMessage);                    messageInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendMessage();
                        }
                    });

                    signInButton.addEventListener('click', () => {
                        vscode.postMessage({
                            type: 'signIn'
                        });
                    });
                    
                    // New chat button
                    newChatButton.addEventListener('click', () => {
                        vscode.postMessage({
                            type: 'newConversation'
                        });
                    });

                    // Handle messages from the extension
                    window.addEventListener('message', event => {
                        const message = event.data;

                        switch (message.type) {
                            case 'authUpdate':
                                updateAuthUI(message.isAuthenticated);
                                // If authenticated, remove auth banner and add welcome message if chat is empty
                                if (message.isAuthenticated) {
                                     authBanner.classList.add('hidden');
                                     // Only add welcome if no messages yet
                                     if (messagesContainer.children.length === 0 || 
                                         (messagesContainer.children.length === 1 && messagesContainer.children[0].classList.contains('loading')))
                                     {
                                        addMessage('👋 Welcome to MEmoX! How can I assist you with your code today?');
                                     }
                                } else {
                                     authBanner.classList.remove('hidden');
                                     // Clear messages when signing out (optional, can adjust based on preference)
                                     // messagesContainer.innerHTML = '';
                                }
                                break;

                            case 'addResponse':
                                // Remove any loading indicators
                                const loadingElements = document.getElementsByClassName('loading');
                                while (loadingElements.length > 0) {
                                    loadingElements[0].remove();
                                }

                                addMessage(message.value, false, message.requiresAuth);
                                break;
                                
                            case 'updateChatHistory':
                                conversations = message.conversations || [];
                                currentConversation = message.currentConversation || null;
                                
                                // Load conversation messages
                                loadConversation(currentConversation);
                                break;
                        }
                    });                     // Function to auto-resize textarea
                     function autoResizeTextarea() {
                         messageInput.style.height = 'auto';
                         messageInput.style.height = (messageInput.scrollHeight) + 'px';
                     }
                     
                     // Initial setup
                     document.addEventListener('DOMContentLoaded', function() {
                         // Initial auth state check will be sent by extension on panel load
                         messageInput.focus();
                         
                         // Set up auto-resize for textarea
                         messageInput.addEventListener('input', autoResizeTextarea);
                     });                     // Request auth state when the webview gains focus
                     window.addEventListener('focus', () => {
                         console.log('MEmoX Webview: Window focused, requesting auth state');
                         vscode.postMessage({
                             type: 'requestAuthState'
                         });
                         messageInput.focus();
                     });

                     // Observer to handle scrolling with dynamically added content
                     const resizeObserver = new ResizeObserver(entries => {
                        for (let entry of entries) {
                            if (entry.target === messagesContainer || 
                                messagesContainer.contains(entry.target)) {
                                messagesContainer.scrollTop = messagesContainer.scrollHeight;
                            }
                        }
                     });
                     
                     // Observe the messages container for size changes
                     resizeObserver.observe(messagesContainer);
                </script>
                
                <!-- Add marked.js library for markdown rendering -->
                <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
                 
                 <!-- Add marked.js library for markdown rendering -->
                 <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
                 <script>
                     // Configure marked with options to match GitHub Copilot's rendering
                     if (window.marked) {
                         marked.setOptions({
                             breaks: true,
                             gfm: true,
                             highlight: function(code, lang) {
                                 // Simple syntax highlighting
                                 if (lang === 'js' || lang === 'javascript') {
                                     code = code
                                         .replace(/(function|const|let|var|return|if|for|while|class|import|export|from|async|await)/g, '<span class="hljs-keyword">$1</span>')
                                         .replace(/('.*?'|".*?")/g, '<span class="hljs-string">$1</span>')
                                         .replace(/(\/\/.*)/g, '<span class="hljs-comment">$1</span>');
                                 }
                                 return code;
                             }
                         });
                     }
                 </script>

            </body>
            </html>
        `;
    }
}