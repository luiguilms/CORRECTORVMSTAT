const { ipcRenderer } = require('electron');

document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('fileInput');
    const processBtn = document.getElementById('processBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const downloadSection = document.getElementById('downloadSection');
    const fileInfo = document.getElementById('fileInfo');
    const results = document.getElementById('results');

    let currentFileContent = '';

    fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            fileInfo.innerHTML = `
                <strong>Archivo:</strong> ${file.name}<br>
                <strong>Tamaño:</strong> ${(file.size / 1024).toFixed(2)} KB<br>
                <strong>Última modificación:</strong> ${new Date(file.lastModified).toLocaleString()}
            `;
            processBtn.disabled = false;
        }
    });

    processBtn.addEventListener('click', async () => {
        const file = fileInput.files[0];
        const fileType = document.querySelector('input[name="fileType"]:checked').value;
        if (!file) return;

        processBtn.disabled = true;
        processBtn.textContent = 'Procesando...';
        results.innerHTML = '<div class="processing">🔄 Analizando y redistribuyendo líneas...</div>';

        try {
            const filePath = file.path;
            const result = await ipcRenderer.invoke('process-file', filePath, fileType);

            if (result.success) {
                currentFileContent = result.content;
                displayResults(result);
                downloadSection.style.display = 'block';
            } else {
                results.innerHTML = `<div class="error">❌ Error: ${result.error}</div>`;
            }
        } catch (error) {
            results.innerHTML = `<div class="error">❌ Error: ${error.message}</div>`;
        } finally {
            processBtn.disabled = false;
            processBtn.textContent = 'Procesar Archivo';
        }
    });

    downloadBtn.addEventListener('click', async () => {
        if (!currentFileContent) return;

        const result = await ipcRenderer.invoke('save-file', currentFileContent);
        
        if (result.success) {
            const successMsg = document.createElement('div');
            successMsg.className = 'success-save';
            successMsg.innerHTML = `💾 <strong>Archivo guardado exitosamente:</strong><br>${result.path}`;
            results.appendChild(successMsg);
        } else {
            const errorMsg = document.createElement('div');
            errorMsg.className = 'error';
            errorMsg.innerHTML = `❌ <strong>Error al guardar:</strong> ${result.error}`;
            results.appendChild(errorMsg);
        }
    });
    function displayResults(result) {
    if (result.fileType === 'ram') {
        displayRamResults(result);
    } else {
        displayCpuResults(result); // Tu función original renombrada
    }
}

    function displayCpuResults(result) {
        const { stats, changes } = result;
        
        let html = `
            <div class="results-summary">
                <h4>📊 Resumen del Procesamiento</h4>
                <div class="stats-grid">
                    <div class="stat-item">
                        <span class="stat-label">Bloques totales:</span>
                        <span class="stat-value">${stats.totalBlocks}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Bloques reorganizados:</span>
                        <span class="stat-value ${stats.fixedBlocks > 0 ? 'changed' : 'unchanged'}">${stats.fixedBlocks}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Líneas originales:</span>
                        <span class="stat-value">${stats.totalLines}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Líneas finales:</span>
                        <span class="stat-value">${stats.correctedLines}</span>
                    </div>
                </div>
            </div>
        `;

        if (changes.length === 0) {
            html += `
                <div class="no-changes">
                    ✅ <strong>¡Perfecto!</strong> El archivo ya tenía el formato correcto.<br>
                    Todos los bloques tienen exactamente 3 líneas de datos cada uno.
                </div>
            `;
        } else {
            html += `
                <div class="changes-section">
                    <h4>🔄 Redistribución de Datos Realizada (${changes.length} bloques afectados)</h4>
                    <div class="redistribution-summary">
                        <p><strong>Problema detectado:</strong> Las líneas de datos estaban distribuidas incorrectamente entre bloques.</p>
                        <p><strong>Solución aplicada:</strong> Se redistribuyeron automáticamente para asegurar exactamente 3 líneas de datos por bloque.</p>
                    </div>
                    <div class="changes-list">
            `;

            changes.forEach((change, index) => {
                if (change.type === 'data_redistribution') {
                    const statusIcon = change.originalDataCount < 3 ? '⬆️' : 
                                     change.originalDataCount > 3 ? '⬇️' : '🔄';
                    const statusText = change.originalDataCount < 3 ? 'Recibió líneas' : 
                                     change.originalDataCount > 3 ? 'Cedió líneas' : 'Intercambió líneas';
                    
                    html += `
                        <div class="change-item redistribution">
                            <div class="change-header">
                                <div class="change-title">
                                    <span class="change-icon">${statusIcon}</span>
                                    <strong>Bloque ${change.blockNumber}</strong>
                                    <span class="status-badge">${statusText}</span>
                                </div>
                                <span class="line-info">Inicia en línea ${change.startLine}</span>
                            </div>
                            <div class="change-details">
                                <div class="data-count-change">
                                    <span class="before">Antes: ${change.originalDataCount} líneas</span>
                                    <span class="arrow">→</span>
                                    <span class="after">Después: ${change.finalDataCount} líneas</span>
                                </div>
                    `;
                    
                    if (change.movedLines.removed.length > 0) {
                        html += `
                            <div class="moved-section removed">
                                <h5>📤 Líneas que se movieron a otros bloques:</h5>
                                <div class="moved-lines">
                                    ${change.movedLines.removed.map(item => `
                                        <div class="moved-line">
                                            <span class="original-line">Línea ${item.originalLine}:</span>
                                            <code>${item.line}</code>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        `;
                    }
                    
                    if (change.movedLines.added.length > 0) {
                        html += `
                            <div class="moved-section added">
                                <h5>📥 Líneas que recibió de otros bloques:</h5>
                                <div class="moved-lines">
                                    ${change.movedLines.added.map(item => `
                                        <div class="moved-line">
                                            <span class="original-line">Línea ${item.originalLine}:</span>
                                            <code>${item.line}</code>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        `;
                    }
                    
                    html += `
                            </div>
                        </div>
                    `;
                }
            });

            html += `
                    </div>
                </div>
            `;
        }

        html += `
            <div class="completion-message">
                <strong>✅ Redistribución completada</strong><br>
                Ahora cada bloque tiene exactamente 7 líneas (2 fechas + 2 encabezados + 3 datos).<br>
                El archivo está listo para descargar.
            </div>
        `;

        results.innerHTML = html;
    }
    function displayRamResults(result) {
    const { stats, changes } = result;
    
    let html = `
        <div class="results-summary">
            <h4>📊 Resumen del Procesamiento (RAM)</h4>
            <div class="stats-grid">
                <div class="stat-item">
                    <span class="stat-label">Bloques originales:</span>
                    <span class="stat-value">${stats.originalBlocks}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Bloques finales:</span>
                    <span class="stat-value ${stats.totalBlocks !== stats.originalBlocks ? 'changed' : 'unchanged'}">${stats.totalBlocks}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Problemas detectados:</span>
                    <span class="stat-value ${changes.length > 0 ? 'changed' : 'unchanged'}">${changes.length}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Líneas reorganizadas:</span>
                    <span class="stat-value ${stats.linesRemoved > 0 ? 'changed' : 'unchanged'}">${stats.linesRemoved}</span>
                </div>
            </div>
        </div>
    `;

    if (changes.length === 0) {
        html += `
            <div class="no-changes">
                ✅ <strong>¡Perfecto!</strong> El archivo RAM ya tiene el formato correcto.<br>
                Todos los bloques tienen exactamente 5 líneas cada uno.
            </div>
        `;
    } else {
        html += `
            <div class="changes-section">
                <h4>🔧 Problemas Detectados y Corregidos (${changes.length} issues)</h4>
        `;

        changes.forEach(change => {
            if (change.type === 'invalid_structure') {
                html += `
                    <div class="change-item incomplete">
                        <div class="change-header incomplete">
                            <div class="change-title">
                                <span class="change-icon">❌</span>
                                <strong>Bloque ${change.blockNumber} - Estructura Inválida</strong>
                            </div>
                            <span class="line-info">Línea ${change.startLine}</span>
                        </div>
                        <div class="change-details">
                            <p><strong>Problema:</strong> ${change.actualLines} líneas (deberían ser 5)</p>
                            <p><strong>Faltan:</strong> ${change.expectedLines - change.actualLines} líneas</p>
                            <div class="fix-applied">
                                🔄 Este bloque fue reconstruido durante la reorganización
                            </div>
                        </div>
                    </div>
                `;
            } else if (change.type === 'invalid_data_count') {
                html += `
                    <div class="change-item incomplete">
                        <div class="change-header incomplete">
                            <div class="change-title">
                                <span class="change-icon">📊</span>
                                <strong>Bloque ${change.blockNumber} - Datos Incompletos</strong>
                            </div>
                            <span class="line-info">Línea ${change.startLine}</span>
                        </div>
                        <div class="change-details">
                            <p><strong>Problema:</strong> ${change.actual} líneas de datos (deberían ser 2)</p>
                            <p><strong>Faltan:</strong> ${change.expected - change.actual} líneas de datos</p>
                        </div>
                    </div>
                `;
            } else if (change.type === 'blocks_redistributed') {
                html += `
                    <div class="change-item redistribution">
                        <div class="change-header redistribution">
                            <div class="change-title">
                                <span class="change-icon">🔄</span>
                                <strong>Redistribución de Bloques</strong>
                            </div>
                        </div>
                        <div class="change-details">
                            <p><strong>Cambio:</strong> ${change.message}</p>
                            <p><strong>Motivo:</strong> Los bloques originales tenían estructura inconsistente</p>
                        </div>
                    </div>
                `;
            }
        });

        html += `</div>`;
    }

    html += `
        <div class="completion-message">
            <strong>✅ Reorganización completada</strong><br>
            Estructura final: <strong>${stats.structure}</strong><br>
            Todos los datos se mantienen preservados en el orden correcto.
        </div>
    `;

    results.innerHTML = html;
}
});