const { ipcRenderer } = require('electron');

document.addEventListener('DOMContentLoaded', () => {
    // Referencias a elementos del DOM
    const selectFolderBtn = document.getElementById('selectFolderBtn');
    const selectedFolder = document.getElementById('selectedFolder');
    const scanBtn = document.getElementById('scanBtn');
    const scanResults = document.getElementById('scanResults');
    const scanSummary = document.getElementById('scanSummary');
    const fileCategories = document.getElementById('fileCategories');
    const processAllBtn = document.getElementById('processAllBtn');
    const processOnlyNeedBtn = document.getElementById('processOnlyNeedBtn');
    const progressSection = document.getElementById('progressSection');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const currentFile = document.getElementById('currentFile');
    const progressLog = document.getElementById('progressLog');
    const finalResults = document.getElementById('finalResults');
    const batchSummary = document.getElementById('batchSummary');
    const detailedResults = document.getElementById('detailedResults');
    const openFolderBtn = document.getElementById('openFolderBtn');
    const exportReportBtn = document.getElementById('exportReportBtn');
    const processOnlyNeedReplaceBtn = document.getElementById('processOnlyNeedReplaceBtn');

    // Variables globales
    let currentFolderPath = '';
    let scanResultsData = null;
    let batchResultsData = null;

    // Event Listeners
    selectFolderBtn.addEventListener('click', selectFolder);
    scanBtn.addEventListener('click', scanFolder);
    processAllBtn.addEventListener('click', () => processFiles('all'));
    processOnlyNeedBtn.addEventListener('click', () => processFiles('needed'));
    openFolderBtn.addEventListener('click', openFolder);
    exportReportBtn.addEventListener('click', exportReport);
    processOnlyNeedReplaceBtn.addEventListener('click', () => processFiles('needed', true));

    // Escuchar progreso del procesamiento por lotes
    ipcRenderer.on('batch-progress', (event, progress) => {
        updateProgress(progress);
    });

    // Función para seleccionar carpeta
    async function selectFolder() {
        try {
            const result = await ipcRenderer.invoke('select-folder');
            
            if (result.success) {
                currentFolderPath = result.folderPath;
                selectedFolder.textContent = result.folderPath;
                scanBtn.disabled = false;
                resetUI();
            } else {
                selectedFolder.textContent = 'No se seleccionó carpeta';
                scanBtn.disabled = true;
            }
        } catch (error) {
            showError('Error al seleccionar carpeta: ' + error.message);
        }
    }

    // Función para escanear carpeta
    async function scanFolder() {
        const fileType = document.querySelector('input[name="fileType"]:checked').value;
        
        scanBtn.disabled = true;
        scanBtn.textContent = 'Escaneando...';
        resetUI();

        try {
            const result = await ipcRenderer.invoke('scan-folder', currentFolderPath, fileType);
            
            if (result.success) {
                scanResultsData = result.results;
                displayScanResults(result.results);
                scanResults.style.display = 'block';
            } else {
                showError('Error al escanear carpeta: ' + result.error);
            }
        } catch (error) {
            showError('Error durante el escaneo: ' + error.message);
        } finally {
            scanBtn.disabled = false;
            scanBtn.textContent = 'Escanear Archivos';
        }
    }

    // Función para mostrar resultados del escaneo
    function displayScanResults(results) {
        // Resumen del escaneo
        scanSummary.innerHTML = `
            <div class="scan-stats">
                <div class="scan-stat">
                    <span class="stat-number total">${results.total}</span>
                    <span class="stat-label">Archivos encontrados</span>
                </div>
                <div class="scan-stat">
                    <span class="stat-number need-correction">${results.needsCorrection.length}</span>
                    <span class="stat-label">Necesitan corrección</span>
                </div>
                <div class="scan-stat">
                    <span class="stat-number correct">${results.alreadyCorrect.length}</span>
                    <span class="stat-label">Ya correctos</span>
                </div>
                <div class="scan-stat">
                    <span class="stat-number errors">${results.hasErrors.length}</span>
                    <span class="stat-label">Con errores</span>
                </div>
            </div>
        `;

        // Categorías de archivos
        let categoriesHTML = '';

        if (results.needsCorrection.length > 0) {
            categoriesHTML += `
                <div class="file-category needs-correction">
                    <h4>📋 Archivos que necesitan corrección (${results.needsCorrection.length})</h4>
                    <div class="file-list">
                        ${results.needsCorrection.map(file => `
                            <div class="file-item">
                                <div class="file-header">
                                    <span class="file-name">${file.name}</span>
                                    <span class="file-issues">${file.analysis.issues} problema(s)</span>
                                </div>
                                <div class="file-details">
                                    <span class="file-size">${(file.size / 1024).toFixed(1)} KB</span>
                                    <span class="file-blocks">${file.analysis.totalBlocks} bloques</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        if (results.alreadyCorrect.length > 0) {
            categoriesHTML += `
                <div class="file-category already-correct">
                    <h4>✅ Archivos ya correctos (${results.alreadyCorrect.length})</h4>
                    <div class="file-list collapsed" id="correctFiles">
                        ${results.alreadyCorrect.map(file => `
                            <div class="file-item">
                                <div class="file-header">
                                    <span class="file-name">${file.name}</span>
                                    <span class="file-status">Formato correcto</span>
                                </div>
                                <div class="file-details">
                                    <span class="file-size">${(file.size / 1024).toFixed(1)} KB</span>
                                    <span class="file-blocks">${file.analysis.totalBlocks} bloques</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    <button class="toggle-list" data-target="correctFiles">Mostrar/Ocultar archivos</button>
                </div>
            `;
        }

        if (results.hasErrors.length > 0) {
            categoriesHTML += `
                <div class="file-category has-errors">
                    <h4>⚠️ Archivos con errores (${results.hasErrors.length})</h4>
                    <div class="file-list">
                        ${results.hasErrors.map(file => `
                            <div class="file-item error">
                                <div class="file-header">
                                    <span class="file-name">${file.name}</span>
                                    <span class="file-error">Error de formato</span>
                                </div>
                                <div class="file-details">
                                    <span class="error-message">${file.error || file.analysis?.error || 'Error desconocido'}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        fileCategories.innerHTML = categoriesHTML;

        // Habilitar botones de procesamiento
        if (results.total > 0) {
            processAllBtn.disabled = false;
        }
        if (results.needsCorrection.length > 0) {
            processOnlyNeedBtn.disabled = false;
            processOnlyNeedReplaceBtn.disabled = false;
        }
    }

    // Función para procesar archivos
    async function processFiles(mode, replaceOriginal = false) {
        let filesToProcess = [];
        
        if (mode === 'all') {
            filesToProcess = [
                ...scanResultsData.needsCorrection,
                ...scanResultsData.alreadyCorrect
            ];
        } else if (mode === 'needed') {
            filesToProcess = scanResultsData.needsCorrection;
        }

        if (filesToProcess.length === 0) {
            showError('No hay archivos para procesar');
            return;
        }

        const fileType = document.querySelector('input[name="fileType"]:checked').value;

        // Mostrar sección de progreso
        progressSection.style.display = 'block';
        scanResults.style.display = 'none';
        progressFill.style.width = '0%';
        progressText.textContent = `0 / ${filesToProcess.length} archivos procesados`;
        progressLog.innerHTML = '';

        // Deshabilitar botones
        processAllBtn.disabled = true;
        processOnlyNeedBtn.disabled = true;

        try {
            const result = await ipcRenderer.invoke('process-batch', filesToProcess, fileType, currentFolderPath, replaceOriginal);
            
            if (result.success) {
                batchResultsData = result.results;
                displayFinalResults(result.results);
                finalResults.style.display = 'block';
                progressSection.style.display = 'none';
            } else {
                showError('Error durante el procesamiento: ' + result.error);
            }
        } catch (error) {
            showError('Error durante el procesamiento: ' + error.message);
        }
    }

    // Función para actualizar progreso
    function updateProgress(progress) {
        const percentage = (progress.current / progress.total) * 100;
        progressFill.style.width = percentage + '%';
        progressText.textContent = `${progress.current} / ${progress.total} archivos procesados`;
        currentFile.textContent = `Procesando: ${progress.fileName}`;

        // Agregar entrada al log
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry';
        logEntry.innerHTML = `
            <span class="log-time">${new Date().toLocaleTimeString()}</span>
            <span class="log-file">${progress.fileName}</span>
            <span class="log-status">Procesando...</span>
        `;
        progressLog.appendChild(logEntry);
        progressLog.scrollTop = progressLog.scrollHeight;
    }

    // Función para mostrar resultados finales
    function displayFinalResults(results) {
        // Resumen del batch
        const successRate = ((results.successCount / results.totalFiles) * 100).toFixed(1);
        
        batchSummary.innerHTML = `
            <div class="batch-stats">
                <div class="batch-stat success">
                    <span class="stat-number">${results.successCount}</span>
                    <span class="stat-label">Archivos procesados exitosamente</span>
                </div>
                <div class="batch-stat errors">
                    <span class="stat-number">${results.errorCount}</span>
                    <span class="stat-label">Archivos con errores</span>
                </div>
                <div class="batch-stat rate">
                    <span class="stat-number">${successRate}%</span>
                    <span class="stat-label">Tasa de éxito</span>
                </div>
                <div class="batch-stat total">
                    <span class="stat-number">${results.totalFiles}</span>
                    <span class="stat-label">Total procesados</span>
                </div>
            </div>
        `;

        // Resultados detallados
        let detailedHTML = '';

        if (results.processed.length > 0) {
            detailedHTML += `
                <div class="results-category processed">
                    <h4>✅ Archivos procesados exitosamente (${results.processed.length})</h4>
                    <div class="processed-files">
                        ${results.processed.map(result => `
                            <div class="processed-file">
                                <div class="file-result-header">
                                    <div class="original-file">
                                        <span class="file-icon">📄</span>
                                        <span class="file-name">${result.originalFile}</span>
                                    </div>
                                    <span class="arrow">→</span>
                                    <div class="corrected-file">
                                        <span class="file-icon">📄</span>
                                        <span class="file-name">${result.correctedFile}</span>
                                    </div>
                                </div>
                                <div class="file-result-details">
                                    <div class="result-stats">
                                        <span class="stat">Bloques: ${result.stats.totalBlocks}</span>
                                        <span class="stat">Cambios: ${result.changes.length}</span>
                                        ${result.changes.length > 0 ? 
                                            `<span class="stat modified">Modificado</span>` : 
                                            `<span class="stat unchanged">Sin cambios</span>`
                                        }
                                    </div>
                                    ${result.changes.length > 0 ? `
                                        <div class="changes-preview">
                                            <strong>Primeros cambios aplicados:</strong>
                                            ${result.changes.slice(0, 2).map(change => `
                                                <div class="change-preview">
                                                    • ${getChangeDescription(change)}
                                                </div>
                                            `).join('')}
                                            ${result.changes.length > 2 ? `<div class="more-changes">... y ${result.changes.length - 2} cambio(s) más</div>` : ''}
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        if (results.errors.length > 0) {
            detailedHTML += `
                <div class="results-category errors">
                    <h4>⚠️ Archivos con errores (${results.errors.length})</h4>
                    <div class="error-files">
                        ${results.errors.map(error => `
                            <div class="error-file">
                                <div class="error-header">
                                    <span class="file-icon">📄</span>
                                    <span class="file-name">${error.fileName}</span>
                                    <span class="error-badge">Error</span>
                                </div>
                                <div class="error-message">${error.error}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        detailedResults.innerHTML = detailedHTML;

        // Agregar mensaje de finalización
        const completionMessage = document.createElement('div');
        completionMessage.className = 'completion-message';
        completionMessage.innerHTML = `
            <h4>🎉 Procesamiento completado</h4>
            <p>Se procesaron ${results.successCount} archivos exitosamente.</p>
            <p>Los archivos corregidos se guardaron con el sufijo "_corregido" en la misma carpeta.</p>
        `;
        detailedResults.appendChild(completionMessage);
    }

    // Función auxiliar para describir cambios
    function getChangeDescription(change) {
    const lineInfo = change.affectedLines ? ` (${change.affectedLines})` : '';
    
    switch (change.type) {
        case 'data_redistribution':
            return `Bloque ${change.blockNumber}${lineInfo}: redistribución de datos (${change.originalDataCount} → ${change.finalDataCount} líneas)`;
        case 'invalid_structure':
            return `Bloque ${change.blockNumber}${lineInfo}: estructura corregida (${change.actualLines} → ${change.expectedLines} líneas)`;
        case 'invalid_data_count':
            return `Bloque ${change.blockNumber}${lineInfo}: datos corregidos (${change.actual} → ${change.expected} líneas de datos)`;
        case 'blocks_redistributed':
            return `Redistribución general: ${change.originalBlocks} → ${change.finalBlocks} bloques`;
        default:
            return `Cambio en bloque ${change.blockNumber || 'N/A'}${lineInfo}`;
    }
}

    // Función para abrir carpeta
    async function openFolder() {
        try {
            await ipcRenderer.invoke('open-folder', currentFolderPath);
        } catch (error) {
            showError('Error al abrir carpeta: ' + error.message);
        }
    }

    // Función para exportar reporte
    async function exportReport() {
        if (!batchResultsData) {
            showError('No hay datos para exportar');
            return;
        }

        const reportContent = generateReport(batchResultsData);
        
        try {
            const result = await ipcRenderer.invoke('export-report', reportContent);
            
            if (result.success) {
                showSuccess('Reporte exportado exitosamente: ' + result.path);
            } else {
                showError('Error al exportar reporte: ' + result.error);
            }
        } catch (error) {
            showError('Error al exportar reporte: ' + error.message);
        }
    }

    // Función para generar contenido del reporte
    function generateReport(results) {
        const date = new Date().toLocaleString();
        const fileType = document.querySelector('input[name="fileType"]:checked').value.toUpperCase();
        
        let report = `REPORTE DE PROCESAMIENTO VMSTAT - ${fileType}\n`;
        report += `Fecha y hora: ${date}\n`;
        report += `Carpeta procesada: ${currentFolderPath}\n`;
        report += `${'='.repeat(60)}\n\n`;

        report += `RESUMEN GENERAL:\n`;
        report += `- Total de archivos: ${results.totalFiles}\n`;
        report += `- Procesados exitosamente: ${results.successCount}\n`;
        report += `- Con errores: ${results.errorCount}\n`;
        report += `- Tasa de éxito: ${((results.successCount / results.totalFiles) * 100).toFixed(1)}%\n\n`;

        if (results.processed.length > 0) {
            report += `ARCHIVOS PROCESADOS EXITOSAMENTE:\n`;
            report += `${'-'.repeat(40)}\n`;
            results.processed.forEach(result => {
                report += `• ${result.originalFile} → ${result.correctedFile}\n`;
                report += `  Bloques: ${result.stats.totalBlocks}, Cambios aplicados: ${result.changes.length}\n`;
                if (result.changes.length > 0) {
                    result.changes.forEach(change => {
                        report += `    - ${getChangeDescription(change)}\n`;
                    });
                }
                report += `\n`;
            });
        }

        if (results.errors.length > 0) {
            report += `ARCHIVOS CON ERRORES:\n`;
            report += `${'-'.repeat(20)}\n`;
            results.errors.forEach(error => {
                report += `• ${error.fileName}: ${error.error}\n`;
            });
            report += `\n`;
        }

        report += `Reporte generado por VMSTAT Corrector v2.0\n`;
        
        return report;
    }

    // Funciones auxiliares
    function resetUI() {
        scanResults.style.display = 'none';
        progressSection.style.display = 'none';
        finalResults.style.display = 'none';
        processAllBtn.disabled = true;
        processOnlyNeedBtn.disabled = true;
        scanResultsData = null;
        batchResultsData = null;
    }

    function showError(message) {
        // Crear notificación de error temporal
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-notification';
        errorDiv.textContent = message;
        document.body.appendChild(errorDiv);
        
        setTimeout(() => {
            errorDiv.remove();
        }, 5000);
    }

    function showSuccess(message) {
        // Crear notificación de éxito temporal
        const successDiv = document.createElement('div');
        successDiv.className = 'success-notification';
        successDiv.textContent = message;
        document.body.appendChild(successDiv);
        
        setTimeout(() => {
            successDiv.remove();
        }, 5000);
    }

    // Función global para toggle de listas (llamada desde HTML)
    // Y en JavaScript:
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('toggle-list')) {
        const targetId = e.target.getAttribute('data-target');
        const list = document.getElementById(targetId);
        if (list) {
            list.classList.toggle('collapsed');
        }
    }
});
});