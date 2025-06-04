import * as vscode from 'vscode';
import { AuthService, AuthState } from '../auth/AuthService';
import { ChatHistoryManager, Conversation, ChatMessage } from './ChatHistoryManager';

export class ChatPanel implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _authService: AuthService;
    private _historyManager: ChatHistoryManager;

    constructor(
        private readonly _context: vscode.ExtensionContext
    ) {
        this._authService = AuthService.getInstance(this._context);
        this._historyManager = ChatHistoryManager.getInstance(this._context);
        
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
    }

    public reveal() {
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
            // Try to get the RAG manager from the extension
            const extension = vscode.extensions.getExtension('memox');
            if (extension) {
                const extensionExports = extension.exports;
                if (extensionExports.ragManager) {
                    // Get relevant context from RAG system
                    const context = await extensionExports.ragManager.getRelevantContext(message);
                    
                    // Use the handleUserMessage function from extension.ts
                    if (extensionExports.handleUserMessage) {
                        const result = await extensionExports.handleUserMessage({
                            content: message,
                            timestamp: Date.now(),
                            context
                        });
                        
                        // Store AI response in chat history
                        this._historyManager.addMessage(result.content, false);
                        
                        // Send response back to webview
                        this._view.webview.postMessage({
                            type: 'addResponse',
                            value: result.content
                        });
                        return;
                    }
                }
            }
            
            // Fallback response if RAG or handler isn't available
            const response = "The AI model is currently initializing. Please try again in a moment or use the Advanced Chat panel via the command palette (MEmoX: Open Advanced Chat).";
            
            // Store AI response in chat history
            this._historyManager.addMessage(response, false);
            
            // Send response back to webview
            this._view.webview.postMessage({
                type: 'addResponse',
                value: response
            });
        } catch (error) {
            console.error('Error handling message:', error);
            const errorMessage = "An error occurred while processing your request. Please try again or use the Advanced Chat panel.";
            
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
        // HTML content unchanged - same as the original file
        return `
            <!DOCTYPE html>
            <html lang="en">
            <!-- HTML content here (same as original) -->
            </html>
        `;
    }
}
