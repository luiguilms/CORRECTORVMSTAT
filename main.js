const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'renderer.js')
        },
        icon: path.join(__dirname, 'icon.png')
    });

    mainWindow.loadFile('index.html');
    mainWindow.maximize(); 
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// IPC handlers
ipcMain.handle('process-file', async (event, filePath) => {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const result = correctVmstatFile(content);
        return { 
            success: true, 
            content: result.correctedContent,
            changes: result.changes,
            stats: result.stats
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('save-file', async (event, content) => {
    try {
        const { filePath } = await dialog.showSaveDialog(mainWindow, {
            filters: [
                { name: 'Text Files', extensions: ['txt'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (filePath) {
            fs.writeFileSync(filePath, content, 'utf8');
            return { success: true, path: filePath };
        }
        return { success: false, error: 'No se seleccionó archivo' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

function correctVmstatFile(content) {
    const originalLines = content.split('\n').filter(line => line.trim() !== '');
    const changes = [];
    let globalLineNumber = 0;
    
    // Paso 1: Separar y categorizar todas las líneas MEJORADO
    const blocks = [];
    let currentBlock = null;
    
    for (let i = 0; i < originalLines.length; i++) {
        const line = originalLines[i];
        globalLineNumber++;
        
        if (isDateLine1(line)) {
            // Nueva fecha tipo 1 = nuevo bloque
            if (currentBlock) {
                blocks.push(currentBlock);
            }
            currentBlock = {
                startLine: globalLineNumber,
                dateLines: [{ line, originalLine: globalLineNumber }],
                headerLines: [],
                dataLines: [],
                blockNumber: blocks.length + 1
            };
        } else if (isDateLine2(line)) {
            if (currentBlock) {
                // Si ya tenemos un bloque, agregar fecha tipo 2
                currentBlock.dateLines.push({ line, originalLine: globalLineNumber });
            } else {
                // Bloque que comienza con fecha tipo 2
                currentBlock = {
                    startLine: globalLineNumber,
                    dateLines: [{ line, originalLine: globalLineNumber }],
                    headerLines: [],
                    dataLines: [],
                    blockNumber: blocks.length + 1
                };
            }
        } else if (isHeaderLine(line)) {
            if (currentBlock) {
                // VERIFICAR SI EL ENCABEZADO YA EXISTE EN ESTE BLOQUE
                const headerAlreadyExists = currentBlock.headerLines.some(
                    header => header.line === line
                );
                
                if (!headerAlreadyExists) {
                    currentBlock.headerLines.push({ line, originalLine: globalLineNumber });
                    
                    // Si es el primer encabezado, verificar si el siguiente también es encabezado único
                    if (currentBlock.headerLines.length === 1 && i + 1 < originalLines.length) {
                        const nextLine = originalLines[i + 1];
                        if (isHeaderLine(nextLine) && nextLine !== line) {
                            const nextHeaderExists = currentBlock.headerLines.some(
                                header => header.line === nextLine
                            );
                            
                            if (!nextHeaderExists) {
                                currentBlock.headerLines.push({ 
                                    line: nextLine, 
                                    originalLine: globalLineNumber + 1 
                                });
                                i++; // Saltar la siguiente línea
                                globalLineNumber++;
                            }
                        }
                    }
                }
            } else {
                // Bloque que comienza con encabezados
                currentBlock = {
                    startLine: globalLineNumber,
                    dateLines: [],
                    headerLines: [{ line, originalLine: globalLineNumber }],
                    dataLines: [],
                    blockNumber: blocks.length + 1
                };
                
                // Verificar si el siguiente también es encabezado único
                if (i + 1 < originalLines.length) {
                    const nextLine = originalLines[i + 1];
                    if (isHeaderLine(nextLine) && nextLine !== line) {
                        currentBlock.headerLines.push({ 
                            line: nextLine, 
                            originalLine: globalLineNumber + 1 
                        });
                        i++; // Saltar la siguiente línea
                        globalLineNumber++;
                    }
                }
            }
        } else if (isDataLine(line)) {
            if (!currentBlock) {
                // Bloque que comienza con datos
                currentBlock = {
                    startLine: globalLineNumber,
                    dateLines: [],
                    headerLines: [],
                    dataLines: [{ line, originalLine: globalLineNumber }],
                    blockNumber: blocks.length + 1
                };
            } else {
                currentBlock.dataLines.push({ line, originalLine: globalLineNumber });
            }
        }
    }
    
    // Agregar el último bloque si existe
    if (currentBlock) {
        blocks.push(currentBlock);
    }
    
    // Paso 2: Para bloques sin encabezados, buscar encabezados del bloque anterior
    for (let i = 1; i < blocks.length; i++) {
        if (blocks[i].headerLines.length === 0 && blocks[i-1].headerLines.length > 0) {
            blocks[i].headerLines = [...blocks[i-1].headerLines];
        }
    }
    
    // Paso 3: Extraer todas las líneas de datos y redistribuirlas
    const allDataLines = [];
    blocks.forEach(block => {
        allDataLines.push(...block.dataLines);
    });
    
    // Paso 4: Redistribuir líneas de datos (3 por bloque)
    const correctedBlocks = [];
    let dataIndex = 0;
    
    for (let i = 0; i < blocks.length; i++) {
        const originalBlock = blocks[i];
        const correctedBlock = {
            ...originalBlock,
            dataLines: []
        };
        
        // Asignar exactamente 3 líneas de datos a cada bloque
        const originalDataCount = originalBlock.dataLines.length;
        const assignedData = [];
        
        for (let j = 0; j < 3 && dataIndex < allDataLines.length; j++) {
            assignedData.push(allDataLines[dataIndex]);
            dataIndex++;
        }
        
        correctedBlock.dataLines = assignedData;
        
        // Registrar cambios si hubo redistribución
        if (originalDataCount !== 3 || hasDataMoved(originalBlock.dataLines, assignedData)) {
            const change = {
                type: 'data_redistribution',
                blockNumber: originalBlock.blockNumber,
                startLine: originalBlock.startLine,
                originalDataCount: originalDataCount,
                finalDataCount: assignedData.length,
                movedLines: getMovedLines(originalBlock.dataLines, assignedData)
            };
            changes.push(change);
        }
        
        correctedBlocks.push(correctedBlock);
    }
    
    // Paso 5: Generar contenido corregido
    const correctedLines = [];
    correctedBlocks.forEach((block) => {
        // 1. Fechas (ambos tipos)
        block.dateLines.forEach(date => correctedLines.push(date.line));
        
        // 2. Encabezados (solo si existen y sin duplicados)
        const uniqueHeaders = [];
        block.headerLines.forEach(header => {
            if (!uniqueHeaders.includes(header.line)) {
                uniqueHeaders.push(header.line);
                correctedLines.push(header.line);
            }
        });
        
        // 3. Exactamente 3 líneas de datos
        block.dataLines.forEach(item => correctedLines.push(item.line));
    });
    
    return {
        correctedContent: correctedLines.join('\n'),
        changes: changes,
        stats: {
            totalBlocks: blocks.length,
            fixedBlocks: changes.length,
            totalLines: originalLines.length,
            correctedLines: correctedLines.length,
            dataLinesRedistributed: changes.reduce((sum, change) => 
                sum + Math.abs(change.originalDataCount - change.finalDataCount), 0)
        }
    };
}

function hasDataMoved(originalData, newData) {
    if (originalData.length !== newData.length) return true;
    
    for (let i = 0; i < originalData.length; i++) {
        if (originalData[i].originalLine !== newData[i].originalLine) {
            return true;
        }
    }
    return false;
}

function getMovedLines(originalData, newData) {
    const moved = {
        removed: [],
        added: []
    };
    
    // Líneas que estaban en el bloque original pero ya no están
    const newOriginalLines = newData.map(item => item.originalLine);
    originalData.forEach(item => {
        if (!newOriginalLines.includes(item.originalLine)) {
            moved.removed.push({
                line: item.line,
                originalLine: item.originalLine
            });
        }
    });
    
    // Líneas que no estaban en el bloque original pero ahora sí están
    const originalOriginalLines = originalData.map(item => item.originalLine);
    newData.forEach(item => {
        if (!originalOriginalLines.includes(item.originalLine)) {
            moved.added.push({
                line: item.line,
                originalLine: item.originalLine
            });
        }
    });
    
    return moved;
}

function isDateLine1(line) {
    return /^\d{2}\/\d{2}\/\d{4}_\d{2}:\d{2}:\d{2}$/.test(line.trim());
}

function isDateLine2(line) {
    return /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\w+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+-\d{2}\s+\d{4}$/.test(line.trim());
}

function isHeaderLine(line) {
    const trimmed = line.trim();
    return trimmed.includes('procs') || 
           trimmed.includes('memory') || 
           trimmed.includes('swap') || 
           trimmed.includes('cpu') ||
           trimmed.includes('r  b');
}

function isDataLine(line) {
    const trimmed = line.trim();
    // Línea que empieza con números y contiene solo números y espacios
    return /^\s*\d+(\s+\d+)*\s*$/.test(trimmed) && 
           !isHeaderLine(line) && 
           !isDateLine1(line) && 
           !isDateLine2(line);
}