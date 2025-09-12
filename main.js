const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
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

// IPC handlers originales
ipcMain.handle('process-file', async (event, filePath, fileType) => {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        let result;
        
        if (fileType === 'ram') {
            result = correctVmstatRamFile(content);
        } else {
            result = correctVmstatFile(content);
        }
        
        return { 
            success: true, 
            content: result.correctedContent,
            changes: result.changes,
            stats: result.stats,
            fileType: fileType
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

// NUEVOS IPC handlers para procesamiento por lotes
ipcMain.handle('select-folder', async () => {
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory'],
            title: 'Seleccionar carpeta con archivos VMSTAT'
        });

        if (!result.canceled && result.filePaths.length > 0) {
            return { success: true, folderPath: result.filePaths[0] };
        }
        return { success: false, error: 'No se seleccionó carpeta' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('scan-folder', async (event, folderPath, fileType) => {
    try {
        const files = fs.readdirSync(folderPath)
            .filter(file => file.toLowerCase().endsWith('.txt'))
            .map(file => path.join(folderPath, file));

        const results = {
            needsCorrection: [],
            alreadyCorrect: [],
            hasErrors: [],
            total: files.length
        };

        for (const filePath of files) {
            try {
                const fileName = path.basename(filePath);
                const content = fs.readFileSync(filePath, 'utf8');
                
                let analysisResult;
                if (fileType === 'ram') {
                    analysisResult = analyzeVmstatRamFile(content);
                } else {
                    analysisResult = analyzeVmstatFile(content);
                }

                const fileInfo = {
                    name: fileName,
                    path: filePath,
                    size: fs.statSync(filePath).size,
                    modified: fs.statSync(filePath).mtime,
                    analysis: analysisResult
                };

                if (analysisResult.hasErrors) {
                    results.hasErrors.push(fileInfo);
                } else if (analysisResult.needsCorrection) {
                    results.needsCorrection.push(fileInfo);
                } else {
                    results.alreadyCorrect.push(fileInfo);
                }
            } catch (error) {
                results.hasErrors.push({
                    name: path.basename(filePath),
                    path: filePath,
                    error: error.message
                });
            }
        }

        return { success: true, results };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('process-batch', async (event, files, fileType, folderPath) => {
    try {
        const results = {
            processed: [],
            errors: [],
            totalFiles: files.length,
            successCount: 0,
            errorCount: 0
        };

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            
            // Enviar progreso al renderer
            mainWindow.webContents.send('batch-progress', {
                current: i + 1,
                total: files.length,
                fileName: file.name
            });

            try {
                const content = fs.readFileSync(file.path, 'utf8');
                let correctionResult;
                
                if (fileType === 'ram') {
                    correctionResult = correctVmstatRamFile(content);
                } else {
                    correctionResult = correctVmstatFile(content);
                }

                // Generar nombre del archivo corregido
                const originalName = path.basename(file.path, '.txt');
                const correctedFileName = `${originalName}_corregido.txt`;
                const correctedFilePath = path.join(folderPath, correctedFileName);

                // Guardar archivo corregido
                fs.writeFileSync(correctedFilePath, correctionResult.correctedContent, 'utf8');

                results.processed.push({
                    originalFile: file.name,
                    correctedFile: correctedFileName,
                    changes: correctionResult.changes,
                    stats: correctionResult.stats
                });
                results.successCount++;

            } catch (error) {
                results.errors.push({
                    fileName: file.name,
                    error: error.message
                });
                results.errorCount++;
            }
        }

        return { success: true, results };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('open-folder', async (event, folderPath) => {
    try {
        await shell.openPath(folderPath);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('export-report', async (event, reportContent) => {
    try {
        const { filePath } = await dialog.showSaveDialog(mainWindow, {
            defaultPath: `reporte_vmstat_${new Date().toISOString().split('T')[0]}.txt`,
            filters: [
                { name: 'Text Files', extensions: ['txt'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (filePath) {
            fs.writeFileSync(filePath, reportContent, 'utf8');
            return { success: true, path: filePath };
        }
        return { success: false, error: 'No se seleccionó archivo' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// FUNCIONES DE ANÁLISIS (antes de procesar)
function analyzeVmstatFile(content) {
    try {
        const result = correctVmstatFile(content);
        return {
            needsCorrection: result.changes.length > 0,
            hasErrors: false,
            issues: result.changes.length,
            totalBlocks: result.stats.totalBlocks,
            preview: result.changes.slice(0, 3) // Primeros 3 cambios para vista previa
        };
    } catch (error) {
        return {
            needsCorrection: false,
            hasErrors: true,
            error: error.message
        };
    }
}

function analyzeVmstatRamFile(content) {
    try {
        const result = correctVmstatRamFile(content);
        return {
            needsCorrection: result.changes.length > 0,
            hasErrors: false,
            issues: result.changes.length,
            totalBlocks: result.stats.totalBlocks,
            preview: result.changes.slice(0, 3)
        };
    } catch (error) {
        return {
            needsCorrection: false,
            hasErrors: true,
            error: error.message
        };
    }
}

// Funciones originales de corrección (sin cambios)
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

function correctVmstatRamFile(content) {
    const originalLines = content.split('\n').filter(line => line.trim() !== '');
    const changes = [];
    let globalLineNumber = 0;
    
    // Paso 1: Separar y categorizar todas las líneas
    const blocks = [];
    let currentBlock = null;
    
    for (let i = 0; i < originalLines.length; i++) {
        const line = originalLines[i];
        globalLineNumber++;
        
        if (isDateLine1(line)) {
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
                currentBlock.dateLines.push({ line, originalLine: globalLineNumber });
            } else {
                currentBlock = {
                    startLine: globalLineNumber,
                    dateLines: [{ line, originalLine: globalLineNumber }],
                    headerLines: [],
                    dataLines: [],
                    blockNumber: blocks.length + 1
                };
            }
        } else if (isMemHeaderLine(line)) {
            if (currentBlock) {
                currentBlock.headerLines.push({ line, originalLine: globalLineNumber });
            } else {
                currentBlock = {
                    startLine: globalLineNumber,
                    dateLines: [],
                    headerLines: [{ line, originalLine: globalLineNumber }],
                    dataLines: [],
                    blockNumber: blocks.length + 1
                };
            }
        } else if (isMemDataLine(line)) {
            if (!currentBlock) {
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
    
    if (currentBlock) {
        blocks.push(currentBlock);
    }
    
    // Analizar bloques originales para detectar problemas
    blocks.forEach(block => {
        const totalLines = block.dateLines.length + block.headerLines.length + block.dataLines.length;
        
        if (totalLines !== 5) {
            changes.push({
                type: 'invalid_structure',
                blockNumber: block.blockNumber,
                startLine: block.startLine,
                expectedLines: 5,
                actualLines: totalLines,
                lines: block.dateLines.concat(block.headerLines, block.dataLines)
            });
        }
        
        if (block.dateLines.length === 0) {
            changes.push({
                type: 'missing_dates',
                blockNumber: block.blockNumber,
                startLine: block.startLine,
                message: 'Bloque sin líneas de fecha'
            });
        }
        
        if (block.headerLines.length === 0) {
            changes.push({
                type: 'missing_header',
                blockNumber: block.blockNumber,
                startLine: block.startLine,
                message: 'Bloque sin encabezado de memoria'
            });
        }
        
        if (block.dataLines.length !== 2) {
            changes.push({
                type: 'invalid_data_count',
                blockNumber: block.blockNumber,
                startLine: block.startLine,
                expected: 2,
                actual: block.dataLines.length,
                dataLines: block.dataLines
            });
        }
    });
    
    // Paso 2: Extraer todas las líneas
    const allDate1Lines = [];
    const allDate2Lines = [];
    const allHeaderLines = [];
    const allDataLines = [];
    
    blocks.forEach(block => {
        allDate1Lines.push(...block.dateLines.filter(d => isDateLine1(d.line)));
        allDate2Lines.push(...block.dateLines.filter(d => isDateLine2(d.line)));
        allHeaderLines.push(...block.headerLines);
        allDataLines.push(...block.dataLines);
    });
    
    const originalDataCount = blocks.reduce((sum, block) => sum + block.dataLines.length, 0);
    const originalBlockCount = blocks.length;
    
    // Paso 3: Reconstruir bloques (2 fechas + 1 header + 2 datos)
    const correctedBlocks = [];
    let date1Index = 0, date2Index = 0, headerIndex = 0, dataIndex = 0;
    
    while (date1Index < allDate1Lines.length || 
           date2Index < allDate2Lines.length || 
           headerIndex < allHeaderLines.length || 
           dataIndex < allDataLines.length) {
        
        const correctedBlock = {
            blockNumber: correctedBlocks.length + 1,
            dateLines: [],
            headerLines: [],
            dataLines: []
        };
        
        if (date1Index < allDate1Lines.length) {
            correctedBlock.dateLines.push(allDate1Lines[date1Index]);
            date1Index++;
        }
        
        if (date2Index < allDate2Lines.length) {
            correctedBlock.dateLines.push(allDate2Lines[date2Index]);
            date2Index++;
        }
        
        if (headerIndex < allHeaderLines.length) {
            correctedBlock.headerLines.push(allHeaderLines[headerIndex]);
            headerIndex++;
        }
        
        for (let j = 0; j < 2 && dataIndex < allDataLines.length; j++) {
            correctedBlock.dataLines.push(allDataLines[dataIndex]);
            dataIndex++;
        }
        
        correctedBlocks.push(correctedBlock);
    }
    
    if (originalBlockCount !== correctedBlocks.length) {
        changes.push({
            type: 'blocks_redistributed',
            originalBlocks: originalBlockCount,
            finalBlocks: correctedBlocks.length,
            message: `Se reorganizaron los bloques de ${originalBlockCount} a ${correctedBlocks.length}`
        });
    }
    
    // Paso 4: Generar contenido corregido
    const correctedLines = [];
    correctedBlocks.forEach(block => {
        block.dateLines.sort((a, b) => {
            const aIsDate1 = isDateLine1(a.line);
            const bIsDate1 = isDateLine1(b.line);
            return aIsDate1 && !bIsDate1 ? -1 : !aIsDate1 && bIsDate1 ? 1 : 0;
        });
        block.dateLines.forEach(date => correctedLines.push(date.line));
        block.headerLines.forEach(header => correctedLines.push(header.line));
        block.dataLines.forEach(data => correctedLines.push(data.line));
    });
    
    return {
        correctedContent: correctedLines.join('\n'),
        changes: changes,
        stats: {
            totalBlocks: correctedBlocks.length,
            originalBlocks: originalBlockCount,
            fixedBlocks: changes.length,
            totalLines: originalLines.length,
            correctedLines: correctedLines.length,
            linesRemoved: originalLines.length - correctedLines.length,
            structure: "2 fechas + 1 header + 2 datos por bloque"
        }
    };
}

// Funciones auxiliares (sin cambios)
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
    const moved = { removed: [], added: [] };
    const newOriginalLines = newData.map(item => item.originalLine);
    originalData.forEach(item => {
        if (!newOriginalLines.includes(item.originalLine)) {
            moved.removed.push({ line: item.line, originalLine: item.originalLine });
        }
    });
    const originalOriginalLines = originalData.map(item => item.originalLine);
    newData.forEach(item => {
        if (!originalOriginalLines.includes(item.originalLine)) {
            moved.added.push({ line: item.line, originalLine: item.originalLine });
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
    return /^\s*\d+(\s+\d+)*\s*$/.test(trimmed) && 
           !isHeaderLine(line) && 
           !isDateLine1(line) && 
           !isDateLine2(line);
}

function isMemHeaderLine(line) {
    const trimmed = line.trim();
    return trimmed.includes('total') && 
           trimmed.includes('used') && 
           trimmed.includes('free') &&
           trimmed.includes('available') &&
           !trimmed.startsWith('Mem:') &&
           !trimmed.startsWith('Swap:');
}

function isMemDataLine(line) {
    const trimmed = line.trim();
    return (trimmed.startsWith('Mem:') || trimmed.startsWith('Swap:')) &&
           !isDateLine1(line) && 
           !isDateLine2(line);
}