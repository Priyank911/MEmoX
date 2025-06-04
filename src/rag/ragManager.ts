import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CodeChunker } from './chunker';
import { VectorStore } from './vectorStore';
import { CodeChunk } from './chunker';

export class RAGManager {
    private chunker: CodeChunker;
    private vectorStore: VectorStore;
    private indexPath: string;

    constructor(context: vscode.ExtensionContext) {
        this.chunker = new CodeChunker();
        this.indexPath = path.join(context.globalStorageUri.fsPath, 'code_index.json');
        this.vectorStore = new VectorStore(this.indexPath);
    }

    async initialize() {
        // Create storage directory if it doesn't exist
        const dir = path.dirname(this.indexPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        // No need to call load, it's done in constructor
    }

    async indexWorkspace() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showInformationMessage('No workspace folder open to index.');
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Indexing workspace for Memox',
            cancellable: false
        }, async (progress, token) => {
            let totalFiles = 0;
            let processedFiles = 0;

            const excludePattern = '{**/node_modules/**,**/.git/**,**/.vscode/**,**/dist/**,**/out/**,**/.next/**,**/.cache/**,**/.DS_Store,**/*.lock,**/*.log,**/.env*,**/.idea/**,**/.vs/**,**/.history/**,**/*.png,**/*.jpg,**/*.jpeg,**/*.gif,**/*.bmp,**/*.svg,**/*.pdf,**/*.doc,**/*.docx,**/*.xls,**/*.xlsx,**/*.ppt,**/*.pptx,**/*.zip,**/*.tar,**/*.gz,**/*.7z,**/*.rar,**/*.exe,**/*.dll,**/*.so,**/*.dylib,**/*.mp3,**/*.mp4,**/*.avi,**/*.mov,**/*.wasm,**/*.node,**/*.afdesign,**/package.json,**/package-lock.json}';

            // First, count total files (excluding binary, ignored, and package.json)
            for (const folder of workspaceFolders) {
                const files = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(folder, '**/*'),
                    excludePattern
                );
                totalFiles += files.length;
            }

            progress.report({ message: `Found ${totalFiles} text files. Starting indexing...` });

            for (const folder of workspaceFolders) {
                const files = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(folder, '**/*'),
                    excludePattern
                );

                for (const file of files) {
                    if (token.isCancellationRequested) {
                        vscode.window.showInformationMessage('Workspace indexing cancelled.');
                        return;
                    }

                    const stat = await vscode.workspace.fs.stat(file);
                    if (stat.size > 1024 * 1024) {
                        processedFiles++;
                        const percentage = Math.round((processedFiles / totalFiles) * 100);
                        progress.report({
                            increment: (1 / totalFiles) * 100,
                            message: `Skipping large file: ${percentage}% - ${path.basename(file.fsPath)}`
                        });
                        continue; // skip files >1MB
                    }

                    try {
                        await vscode.window.withProgress({
                            location: vscode.ProgressLocation.Notification,
                            title: `Indexing file: ${path.basename(file.fsPath)}`,
                            cancellable: false
                        }, async (fileProgress) => {
                            const document = await vscode.workspace.openTextDocument(file.fsPath);
                            const lines = document.getText().split('\n');
                            const totalLines = lines.length;
                            let processedLines = 0;

                            // We'll chunk the file in batches of lines for progress reporting
                            const chunkSize = 50;
                            for (let i = 0; i < totalLines; i += chunkSize) {
                                // Simulate chunking by lines (actual chunking is handled in chunkFile)
                                processedLines = Math.min(i + chunkSize, totalLines);
                                fileProgress.report({
                                    increment: (chunkSize / totalLines) * 100,
                                    message: `Indexed ${processedLines}/${totalLines} lines`
                                });
                                // Small delay to allow UI update (remove in production for speed)
                                await new Promise(res => setTimeout(res, 1));
                            }
                            // Now actually chunk and add to vector store
                            const chunks = await this.chunker.chunkFile(file.fsPath);
                            await this.vectorStore.addChunks(chunks);
                        });
                        processedFiles++;
                        const percentage = Math.round((processedFiles / totalFiles) * 100);
                        progress.report({
                            increment: (1 / totalFiles) * 100,
                            message: `Indexing: ${percentage}% - ${path.basename(file.fsPath)}`
                        });
                    } catch (error: any) {
                        console.warn(`Skipping file due to error: ${file.fsPath}`, error);
                        processedFiles++;
                        const percentage = Math.round((processedFiles / totalFiles) * 100);
                        progress.report({
                            increment: (1 / totalFiles) * 100,
                            message: `Error/Skipped: ${percentage}% - ${path.basename(file.fsPath)}`
                        });
                    }
                }
            }

            progress.report({ increment: 100, message: 'Indexing complete!' });
            vscode.window.showInformationMessage('Memox workspace indexing complete.');
        });
    }

    async search(query: string, k: number = 5): Promise<CodeChunk[]> {
        return this.vectorStore.search(query, k);
    }    async getRelevantContext(query: string, maxTokens: number = 1536): Promise<string> {
        try {
            // Increase number of chunks to get more context
            const chunks = await this.search(query, 10); 
            
            if (!chunks || chunks.length === 0) {
                return "No relevant code context found for this query.";
            }
            
            let context = '';
            let currentTokens = 0;
            const tokensPerLine = 4; // Estimate tokens per line of code
            
            // Detect query intent (might be looking for a specific file)
            const fileNameMatch = query.match(/\b(in|file|path|module)\b.+?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/i);
            const specificFile = fileNameMatch ? fileNameMatch[2] : null;
              // Group chunks by file to provide better context organization
            let fileChunks: { [filename: string]: CodeChunk[] } = {};
            for (const chunk of chunks) {
                const filename = chunk.metadata.filename;
                if (!fileChunks[filename]) {
                    fileChunks[filename] = [];
                }
                fileChunks[filename].push(chunk);
            }
            
            // If user is asking about a specific file, prioritize that file
            if (specificFile) {
                // Find the best matching file
                const matchingFiles = Object.keys(fileChunks).filter(f => 
                    f.toLowerCase().includes(specificFile.toLowerCase()));
                
                if (matchingFiles.length > 0) {
                    // Reorder the files to prioritize the matched one(s)
                    const orderedFiles = [
                        ...matchingFiles,
                        ...Object.keys(fileChunks).filter(f => !matchingFiles.includes(f))
                    ];
                    
                    const reorderedFileChunks: { [filename: string]: CodeChunk[] } = {};
                    for (const file of orderedFiles) {
                        reorderedFileChunks[file] = fileChunks[file];
                    }
                    
                    fileChunks = reorderedFileChunks;
                }
            }
            
            // Calculate how many tokens we can allocate per file
            const targetTokensPerFile = Math.floor(maxTokens / Math.min(Object.keys(fileChunks).length, 5));
            
            // Keep track of included files for summary
            const includedFiles: string[] = [];
            const partialFiles: string[] = [];
            
            // Build context with file grouping
            for (const filename in fileChunks) {
                // Token budget for this file's header
                const fileHeader = `\n--- File: ${filename} ---\n`;
                const headerTokens = fileHeader.split(/\s+/).length;
                
                if (currentTokens + headerTokens > maxTokens) {
                    break;
                }
                
                // Start with file header
                let fileContext = fileHeader;
                let fileTokens = headerTokens;
                let includeCompleteFile = true;
                
                // Sort chunks by line number to maintain code flow
                fileChunks[filename].sort((a, b) => a.metadata.startLine - b.metadata.startLine);
                
                // Check if the chunks are continuous or have gaps
                const orderedChunks = [...fileChunks[filename]];
                const mergedChunks: CodeChunk[] = [];
                
                // Try to merge adjacent or overlapping chunks
                for (let i = 0; i < orderedChunks.length; i++) {
                    const current = orderedChunks[i];
                    const prev = mergedChunks[mergedChunks.length - 1];
                    
                    if (prev && current.metadata.startLine <= prev.metadata.endLine + 3) {
                        // Merge with previous chunk if they're close (within 3 lines)
                        prev.metadata.endLine = Math.max(prev.metadata.endLine, current.metadata.endLine);
                        // Update the content to include both chunks
                        const combinedContent = prev.content + '\n' + current.content;
                        prev.content = combinedContent;
                    } else {
                        mergedChunks.push({...current});
                    }
                }
                
                // Add chunks with appropriate headers
                for (const chunk of mergedChunks) {
                    const chunkHeader = `\n// Lines ${chunk.metadata.startLine}-${chunk.metadata.endLine}`;
                    const chunkHeaderComment = chunk.metadata.type === 'function' || chunk.metadata.type === 'class' 
                        ? ` (${chunk.metadata.type})` 
                        : '';
                    const fullChunkHeader = chunkHeader + chunkHeaderComment + ':\n';
                    
                    const chunkContent = `${chunk.content}\n`;
                    const totalChunkTokens = (fullChunkHeader.length + chunkContent.length) * tokensPerLine / 100;
                    
                    if (fileTokens + totalChunkTokens > targetTokensPerFile) {
                        includeCompleteFile = false;
                        fileContext += "\n// Additional code from this file was found but omitted due to token limits\n";
                        break;
                    }
                    
                    fileContext += fullChunkHeader + chunkContent;
                    fileTokens += totalChunkTokens;
                }
                
                // Add this file's context to the overall context
                if (currentTokens + fileTokens <= maxTokens) {
                    context += fileContext;
                    currentTokens += fileTokens;
                    
                    if (includeCompleteFile) {
                        includedFiles.push(filename);
                    } else {
                        partialFiles.push(filename);
                    }
                } else {
                    break;
                }
            }
            
            // Add a summary at the start
            const summary = `Code context from ${includedFiles.length + partialFiles.length} files:\n` +
                (includedFiles.length > 0 ? `- Complete context: ${includedFiles.join(', ')}\n` : '') +
                (partialFiles.length > 0 ? `- Partial context: ${partialFiles.join(', ')}\n` : '');
            
            // Check if we have more files that couldn't be included
            const remainingFiles = Object.keys(fileChunks).length - (includedFiles.length + partialFiles.length);
            const remainingNote = remainingFiles > 0 
                ? `\nNote: ${remainingFiles} more relevant files were found but omitted due to token limits.\n` 
                : '';
            
            return summary + remainingNote + context;
        } catch (error) {
            console.error('Error in getRelevantContext:', error);
            return `Error retrieving code context: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
} 