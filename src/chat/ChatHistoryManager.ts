import * as vscode from 'vscode';

export interface ChatMessage {
    content: string;
    isUser: boolean;
    timestamp: number;
}

export interface Conversation {
    id: string;
    title: string;
    messages: ChatMessage[];
    createdAt: number;
    updatedAt: number;
}

export class ChatHistoryManager {
    private static instance: ChatHistoryManager;
    private static readonly STORAGE_KEY = 'memox.chatHistory';
    private static readonly MAX_HISTORY = 6; // Maximum number of conversations to store
    
    private conversations: Conversation[] = [];
    private currentConversationId: string | null = null;
    
    private constructor(private readonly context: vscode.ExtensionContext) {
        this.loadHistory();
    }
    
    public static getInstance(context: vscode.ExtensionContext): ChatHistoryManager {
        if (!ChatHistoryManager.instance) {
            ChatHistoryManager.instance = new ChatHistoryManager(context);
        }
        return ChatHistoryManager.instance;
    }
    
    /**
     * Load chat history from storage
     */
    private loadHistory(): void {
        const history = this.context.workspaceState.get<Conversation[]>(ChatHistoryManager.STORAGE_KEY, []);
        this.conversations = history;
    }
    
    /**
     * Save chat history to storage
     */
    private saveHistory(): void {
        this.context.workspaceState.update(ChatHistoryManager.STORAGE_KEY, this.conversations);
    }
    
    /**
     * Create a new conversation
     */
    public createConversation(): string {
        // No longer adds a new conversation immediately. Just clears the current conversation ID.
        this.currentConversationId = null;
        return '';
    }
    
    /**
     * Get the current conversation
     */
    public getCurrentConversation(): Conversation | null {
        if (!this.currentConversationId) {
            return null;
        }
        
        return this.conversations.find(c => c.id === this.currentConversationId) || null;
    }
    
    /**
     * Get all conversations in history
     */
    public getConversations(): Conversation[] {
        return [...this.conversations];
    }
    
    /**
     * Add a message to the current conversation
     */
    public addMessage(content: string, isUser: boolean): void {
        if (!this.currentConversationId) {
            // Actually create and add a new conversation only when the first message is sent
            const id = this.generateId();
            const newConversation: Conversation = {
                id,
                title: 'New Conversation',
                messages: [],
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
            this.conversations.unshift(newConversation);
            // Limit the number of stored conversations
            if (this.conversations.length > ChatHistoryManager.MAX_HISTORY) {
                this.conversations = this.conversations.slice(0, ChatHistoryManager.MAX_HISTORY);
            }
            this.currentConversationId = id;
            this.saveHistory();
        }
        
        const conversation = this.getCurrentConversation();
        if (!conversation) {
            return;
        }
        
        const message: ChatMessage = {
            content,
            isUser,
            timestamp: Date.now()
        };
        
        conversation.messages.push(message);
        conversation.updatedAt = Date.now();
        
        // If this is the first user message, generate a title
        if (isUser && conversation.messages.length === 1) {
            conversation.title = this.generateTitleFromMessage(content);
        }
        
        this.saveHistory();
    }
    
    /**
     * Generate a title from the first message content
     */
    private generateTitleFromMessage(message: string): string {
        // Extract the first few words (up to 5) or 30 characters
        const words = message.split(/\s+/);
        let title = words.slice(0, 5).join(' ');
        
        // Truncate if needed and add ellipsis
        if (title.length > 30) {
            title = title.substring(0, 30).trim() + '...';
        } else if (words.length > 5) {
            title += '...';
        }
        
        return title;
    }
    
    /**
     * Switch to a specific conversation by ID
     */
    public switchConversation(id: string): boolean {
        const exists = this.conversations.some(c => c.id === id);
        if (exists) {
            this.currentConversationId = id;
            return true;
        }
        return false;
    }
    
    /**
     * Clear the current conversation
     */
    public clearCurrentConversation(): void {
        if (this.currentConversationId) {
            const index = this.conversations.findIndex(c => c.id === this.currentConversationId);
            if (index !== -1) {
                this.conversations.splice(index, 1);
                this.saveHistory();
            }
            this.currentConversationId = null;
        }
    }
    
    /**
     * Get conversation by ID
     */
    public getConversationById(id: string): Conversation | null {
        return this.conversations.find(c => c.id === id) || null;
    }
    
    /**
     * Generate a unique ID for a conversation
     */
    private generateId(): string {
        return 'conv_' + Date.now().toString() + '_' + Math.random().toString(36).substring(2, 10);
    }
    
    /**
     * Delete a conversation
     */
    public deleteConversation(id: string): boolean {
        const index = this.conversations.findIndex(c => c.id === id);
        if (index !== -1) {
            this.conversations.splice(index, 1);
            this.saveHistory();
            
            // If we deleted the current conversation, set current to null
            if (this.currentConversationId === id) {
                this.currentConversationId = this.conversations.length > 0 ? this.conversations[0].id : null;
            }
            return true;
        }
        return false;
    }
}