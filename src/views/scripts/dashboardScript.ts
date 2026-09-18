export function getDashboardScript(initialTab: string, preferredFilter: string): string {
  return `
    const vscode = acquireVsCodeApi();
    let activeFilter = ${JSON.stringify(preferredFilter)};
    const searchInput = document.getElementById('searchInput');
    const sortSelect = document.getElementById('sortSelect');
    const showHiddenCheck = document.getElementById('showHiddenCheck');
    const chips = document.querySelectorAll('.filter-chip');

    // Tab state & DOM elements
    let activeTab = '${initialTab}';
    let isPaused = false;

    // Console Log State (Newest first)
    let allLogLines = [];
    let consoleLogLimit = 500;
    let consolePageSize = 100;
    let consoleCurrentPage = 1;
    let consoleDateMode = 'all'; // 'today' | 'all' | 'custom'
    let consoleIntervalMs = 2500;

    // Analytics State
    let allAnalyticsLogs = [];
    let analyticsLimit = 50;
    let analyticsPageSize = 20;
    let analyticsCurrentPage = 1;
    let analyticsDateMode = 'all'; // 'today' | 'all' | 'custom'
    let analyticsTimer = null;

    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabProviders = document.getElementById('tab-providers');
    const tabAnalytics = document.getElementById('tab-analytics');
    const tabConsole = document.getElementById('tab-console');

    const terminalContainer = document.getElementById('terminalContainer');
    const btnPause = document.getElementById('btnPause');
    const btnClearLogs = document.getElementById('btnClearLogs');
    const btnReconnectStream = document.getElementById('btnReconnectStream');
    const chkAutoScroll = document.getElementById('chkAutoScroll');
    const txtLogFilter = document.getElementById('txtLogFilter');
    const logCountBadge = document.getElementById('logCountBadge');
    const btnRefreshAnalytics = document.getElementById('btnRefreshAnalytics');

    function getTodayIso() {
      const d = new Date();
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return year + '-' + month + '-' + day;
    }

    function getDateVariants(isoDate) {
      if (!isoDate || !isoDate.includes('-')) return [];
      const parts = isoDate.split('-');
      const y = parts[0];
      const m = parts[1];
      const d = parts[2];
      return [
        y + '-' + m + '-' + d,
        d + '-' + m + '-' + y,
        d + '/' + m + '/' + y,
        y + '/' + m + '/' + d,
        d + '.' + m + '.' + y,
        m + '/' + d + '/' + y
      ];
    }

    function matchesDate(text, selectedIsoDate, isTodayMode) {
      if (!selectedIsoDate) return true;
      const variants = getDateVariants(selectedIsoDate);
      for (let i = 0; i < variants.length; i++) {
        if (text.includes(variants[i])) return true;
      }
      if (isTodayMode) {
        const hasOtherYear = /\b20\d\d\b/.test(text);
        if (!hasOtherYear) return true;
      }
      return false;
    }

    // Midnight watch timer
    let currentMidnightDay = getTodayIso();
    setInterval(() => {
      const nowDay = getTodayIso();
      if (nowDay !== currentMidnightDay) {
        currentMidnightDay = nowDay;
        if (consoleDateMode === 'today') {
          const dp = document.getElementById('consoleDatePicker');
          if (dp) dp.value = nowDay;
          renderLogs();
        }
        if (analyticsDateMode === 'today') {
          const adp = document.getElementById('analyticsDatePicker');
          if (adp) adp.value = nowDay;
          renderAnalyticsTable();
        }
      }
    }, 30000);

    function switchTab(newTab) {
      if (activeTab === newTab) return;
      const prevTab = activeTab;
      activeTab = newTab;

      tabBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === activeTab);
      });

      if (tabProviders) tabProviders.style.display = activeTab === 'providers' ? 'block' : 'none';
      if (tabAnalytics) tabAnalytics.style.display = activeTab === 'analytics' ? 'block' : 'none';
      if (tabConsole) tabConsole.style.display = activeTab === 'console' ? 'block' : 'none';

      if (prevTab === 'console' && activeTab !== 'console') {
        vscode.postMessage({ command: 'stopConsoleStream' });
      }

      if (activeTab === 'console' && prevTab !== 'console') {
        const streamBadge = document.getElementById('streamStatusBadge');
        if (streamBadge) {
          streamBadge.textContent = '● Connecting...';
          streamBadge.style.background = '#238636';
        }
        vscode.postMessage({
          command: 'startConsoleStream',
          intervalMs: consoleIntervalMs,
          initialLimit: consoleLogLimit
        });
        if (chkAutoScroll && chkAutoScroll.checked && !isPaused && terminalContainer) {
          terminalContainer.scrollTop = 0;
        }
      } else if (activeTab === 'analytics') {
        vscode.postMessage({ command: 'fetchAnalytics', limit: analyticsLimit, page: 1 });
      }
    }

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
      });
    });

    if (activeTab === 'console') {
      const streamBadge = document.getElementById('streamStatusBadge');
      if (streamBadge) {
        streamBadge.textContent = '● Connecting...';
        streamBadge.style.background = '#238636';
      }
      vscode.postMessage({
        command: 'startConsoleStream',
        intervalMs: consoleIntervalMs,
        initialLimit: consoleLogLimit
      });
    } else if (activeTab === 'analytics') {
      vscode.postMessage({ command: 'fetchAnalytics', limit: analyticsLimit, page: 1 });
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function formatCompactNum(num) {
      const n = Number(num) || 0;
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return String(n);
    }

    function formatLogLine(text) {
      const raw = text == null ? '' : String(text);
      const escaped = escapeHtml(raw);
      if (raw.startsWith('[SYSTEM]') || raw.includes('[TUNNEL LIVE]') || raw.includes('[INIT]') || raw.includes('[SOCKET]') || raw.includes('[WATCHDOG]')) {
        return '<span class="log-system">ℹ ' + escaped + '</span>';
      } else if (raw.includes('DONE ')) {
        return '<span class="log-done">' + escaped + '</span>';
      } else if (raw.includes('POST ')) {
        return '<span class="log-post">' + escaped + '</span>';
      } else if (raw.includes('[TOKEN_REFRESH]')) {
        return '<span class="log-refresh">' + escaped + '</span>';
      } else if (raw.includes('[WARN]') || raw.includes('[HEADROOM]')) {
        return '<span class="log-warn">' + escaped + '</span>';
      } else if (raw.includes('[ERROR]') || raw.includes('ERR') || raw.includes('[STREAM ERROR]')) {
        return '<span class="log-error">' + escaped + '</span>';
      }
      return '<span class="log-default">' + escaped + '</span>';
    }

    function getFilteredLogs() {
      const filter = (txtLogFilter ? txtLogFilter.value : '').trim().toLowerCase();
      const datePicker = document.getElementById('consoleDatePicker');
      const selectedDate = datePicker ? datePicker.value : '';
      const isTodayMode = consoleDateMode === 'today';

      return allLogLines.filter(line => {
        if (filter && !line.toLowerCase().includes(filter)) {
          return false;
        }
        if (consoleDateMode === 'all') {
          return true;
        }
        return matchesDate(line, selectedDate, isTodayMode);
      });
    }

    function renderLogs() {
      if (!terminalContainer) return;
      const filtered = getFilteredLogs();
      const totalLogs = filtered.length;
      const totalPages = Math.max(1, Math.ceil(totalLogs / consolePageSize));

      if (consoleCurrentPage > totalPages) consoleCurrentPage = totalPages;
      if (consoleCurrentPage < 1) consoleCurrentPage = 1;

      if (logCountBadge) {
        logCountBadge.textContent = totalLogs + ' logs';
      }

      const pageInfo = document.getElementById('consolePageInfo');
      if (pageInfo) {
        pageInfo.textContent = 'Page ' + consoleCurrentPage + ' / ' + totalPages + ' (' + totalLogs + ' logs)';
      }

      const btnFirst = document.getElementById('btnConsoleFirst');
      const btnPrev = document.getElementById('btnConsolePrev');
      const btnNext = document.getElementById('btnConsoleNext');
      const btnLast = document.getElementById('btnConsoleLast');
      if (btnFirst) btnFirst.disabled = consoleCurrentPage <= 1;
      if (btnPrev) btnPrev.disabled = consoleCurrentPage <= 1;
      if (btnNext) btnNext.disabled = consoleCurrentPage >= totalPages;
      if (btnLast) btnLast.disabled = consoleCurrentPage >= totalPages;

      if (totalLogs === 0) {
        const filter = (txtLogFilter ? txtLogFilter.value : '').trim();
        if (!filter && consoleDateMode === 'all') {
          terminalContainer.innerHTML = '<div id="terminalEmptyHint" class="terminal-placeholder" style="color:#8b949e;padding:12px;font-style:italic;">Connecting to 9Router Live Console stream... Waiting for incoming logs.</div>';
        } else {
          terminalContainer.innerHTML = '<div class="terminal-placeholder" style="color:#8b949e;padding:12px;font-style:italic;">No logs match current filter.</div>';
        }
        return;
      }

      const startIdx = (consoleCurrentPage - 1) * consolePageSize;
      const pageItems = filtered.slice(startIdx, startIdx + consolePageSize);
      terminalContainer.innerHTML = pageItems.map(l => '<div class="terminal-line">' + formatLogLine(l) + '</div>').join('');

      if (chkAutoScroll && chkAutoScroll.checked && !isPaused && consoleCurrentPage === 1) {
        terminalContainer.scrollTop = 0;
      }
    }

    function getFilteredAnalyticsLogs() {
      const datePicker = document.getElementById('analyticsDatePicker');
      const selectedDate = datePicker ? datePicker.value : '';
      const isTodayMode = analyticsDateMode === 'today';

      return allAnalyticsLogs.filter(item => {
        if (analyticsDateMode === 'all') return true;
        const t = (item.timestamp || '') + ' ' + (item.raw || '');
        return matchesDate(t, selectedDate, isTodayMode);
      });
    }

    function renderAnalyticsTable() {
      const tbody = document.getElementById('analyticsTableBody');
      if (!tbody) return;

      const filtered = getFilteredAnalyticsLogs();
      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / analyticsPageSize));

      if (analyticsCurrentPage > totalPages) analyticsCurrentPage = totalPages;
      if (analyticsCurrentPage < 1) analyticsCurrentPage = 1;

      const pageInfo = document.getElementById('analyticsPageInfo');
      if (pageInfo) {
        pageInfo.textContent = 'Page ' + analyticsCurrentPage + ' / ' + totalPages + ' (' + total + ' requests)';
      }

      const btnFirst = document.getElementById('btnAnalyticsFirst');
      const btnPrev = document.getElementById('btnAnalyticsPrev');
      const btnNext = document.getElementById('btnAnalyticsNext');
      const btnLast = document.getElementById('btnAnalyticsLast');
      if (btnFirst) btnFirst.disabled = analyticsCurrentPage <= 1;
      if (btnPrev) btnPrev.disabled = analyticsCurrentPage <= 1;
      if (btnNext) btnNext.disabled = analyticsCurrentPage >= totalPages;
      if (btnLast) btnLast.disabled = analyticsCurrentPage >= totalPages;

      if (total === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="analytics-empty">No recent requests recorded for selected filter.</td></tr>';
        return;
      }

      const startIdx = (analyticsCurrentPage - 1) * analyticsPageSize;
      const pageItems = filtered.slice(startIdx, startIdx + analyticsPageSize);

      tbody.innerHTML = pageItems.map(log => {
        const statusStr = String(log.status || '');
        const isSuccess = statusStr.startsWith('2') || statusStr.toLowerCase() === 'ok';
        const statusClass = isSuccess ? 'success' : 'error';
        return '<tr>' +
          '<td>' + escapeHtml(log.timestamp || '') + '</td>' +
          '<td><strong>' + escapeHtml(log.model || '') + '</strong></td>' +
          '<td><span class="badge provider">' + escapeHtml(log.provider || '') + '</span></td>' +
          '<td>' + escapeHtml(log.account || '') + '</td>' +
          '<td>' + formatCompactNum(log.inTokens || 0) + ' / ' + formatCompactNum(log.outTokens || 0) + '</td>' +
          '<td><span class="status-badge ' + statusClass + '">' + escapeHtml(statusStr) + '</span></td>' +
        '</tr>';
      }).join('');
    }

    if (btnPause) {
      btnPause.addEventListener('click', () => {
        isPaused = !isPaused;
        btnPause.textContent = isPaused ? '▶ Resume' : '⏸ Pause';
        btnPause.classList.toggle('btn-primary', isPaused);
      });
    }

    if (btnClearLogs) {
      btnClearLogs.addEventListener('click', () => {
        allLogLines = [];
        consoleCurrentPage = 1;
        renderLogs();
        vscode.postMessage({ command: 'clearConsoleLogs' });
      });
    }

    if (btnReconnectStream) {
      btnReconnectStream.addEventListener('click', () => {
        const streamBadge = document.getElementById('streamStatusBadge');
        if (streamBadge) {
          streamBadge.textContent = '● Reconnecting...';
          streamBadge.style.background = '#d29922';
        }
        vscode.postMessage({
          command: 'startConsoleStream',
          intervalMs: consoleIntervalMs,
          initialLimit: consoleLogLimit
        });
      });
    }

    if (txtLogFilter) {
      txtLogFilter.addEventListener('input', () => {
        consoleCurrentPage = 1;
        renderLogs();
      });
    }

    // Console Toolbar Listeners
    const consoleLimitSelect = document.getElementById('consoleLimitSelect');
    if (consoleLimitSelect) {
      consoleLimitSelect.addEventListener('change', (e) => {
        consoleLogLimit = parseInt(e.target.value, 10);
        if (allLogLines.length > consoleLogLimit) {
          allLogLines.length = consoleLogLimit;
        }
        consoleCurrentPage = 1;
        renderLogs();
      });
    }

    const consoleDatePicker = document.getElementById('consoleDatePicker');
    const btnConsoleToday = document.getElementById('btnConsoleToday');
    const btnConsoleAll = document.getElementById('btnConsoleAll');

    if (consoleDatePicker) {
      consoleDatePicker.value = getTodayIso();
      consoleDatePicker.addEventListener('change', () => {
        consoleDateMode = 'custom';
        btnConsoleToday?.classList.remove('active');
        btnConsoleAll?.classList.remove('active');
        consoleCurrentPage = 1;
        renderLogs();
      });
    }

    btnConsoleToday?.addEventListener('click', () => {
      consoleDateMode = 'today';
      if (consoleDatePicker) consoleDatePicker.value = getTodayIso();
      btnConsoleToday.classList.add('active');
      btnConsoleAll?.classList.remove('active');
      consoleCurrentPage = 1;
      renderLogs();
    });

    btnConsoleAll?.addEventListener('click', () => {
      consoleDateMode = 'all';
      btnConsoleAll.classList.add('active');
      btnConsoleToday?.classList.remove('active');
      consoleCurrentPage = 1;
      renderLogs();
    });

    const consoleIntervalSelect = document.getElementById('consoleIntervalSelect');
    if (consoleIntervalSelect) {
      consoleIntervalSelect.addEventListener('change', (e) => {
        consoleIntervalMs = parseInt(e.target.value, 10);
        vscode.postMessage({
          command: 'updateConsoleInterval',
          intervalMs: consoleIntervalMs,
          initialLimit: consoleLogLimit
        });
      });
    }

    const consolePageSizeSelect = document.getElementById('consolePageSizeSelect');
    if (consolePageSizeSelect) {
      consolePageSizeSelect.addEventListener('change', (e) => {
        consolePageSize = parseInt(e.target.value, 10);
        consoleCurrentPage = 1;
        renderLogs();
      });
    }

    document.getElementById('btnConsoleFirst')?.addEventListener('click', () => {
      consoleCurrentPage = 1;
      renderLogs();
    });
    document.getElementById('btnConsolePrev')?.addEventListener('click', () => {
      if (consoleCurrentPage > 1) {
        consoleCurrentPage--;
        renderLogs();
      }
    });
    document.getElementById('btnConsoleNext')?.addEventListener('click', () => {
      consoleCurrentPage++;
      renderLogs();
    });
    document.getElementById('btnConsoleLast')?.addEventListener('click', () => {
      const filtered = getFilteredLogs();
      consoleCurrentPage = Math.max(1, Math.ceil(filtered.length / consolePageSize));
      renderLogs();
    });

    // Analytics Toolbar Listeners
    const analyticsLimitSelect = document.getElementById('analyticsLimitSelect');
    if (analyticsLimitSelect) {
      analyticsLimitSelect.addEventListener('change', (e) => {
        analyticsLimit = parseInt(e.target.value, 10);
        analyticsCurrentPage = 1;
        vscode.postMessage({ command: 'fetchAnalytics', limit: analyticsLimit, page: 1 });
      });
    }

    const analyticsDatePicker = document.getElementById('analyticsDatePicker');
    const btnAnalyticsToday = document.getElementById('btnAnalyticsToday');
    const btnAnalyticsAll = document.getElementById('btnAnalyticsAll');

    if (analyticsDatePicker) {
      analyticsDatePicker.value = getTodayIso();
      analyticsDatePicker.addEventListener('change', () => {
        analyticsDateMode = 'custom';
        btnAnalyticsToday?.classList.remove('active');
        btnAnalyticsAll?.classList.remove('active');
        analyticsCurrentPage = 1;
        renderAnalyticsTable();
      });
    }

    btnAnalyticsToday?.addEventListener('click', () => {
      analyticsDateMode = 'today';
      if (analyticsDatePicker) analyticsDatePicker.value = getTodayIso();
      btnAnalyticsToday.classList.add('active');
      btnAnalyticsAll?.classList.remove('active');
      analyticsCurrentPage = 1;
      renderAnalyticsTable();
    });

    btnAnalyticsAll?.addEventListener('click', () => {
      analyticsDateMode = 'all';
      btnAnalyticsAll.classList.add('active');
      btnAnalyticsToday?.classList.remove('active');
      consoleCurrentPage = 1;
      renderAnalyticsTable();
    });

    document.getElementById('btnAnalyticsFirst')?.addEventListener('click', () => {
      analyticsCurrentPage = 1;
      renderAnalyticsTable();
    });
    document.getElementById('btnAnalyticsPrev')?.addEventListener('click', () => {
      if (analyticsCurrentPage > 1) {
        analyticsCurrentPage--;
        renderAnalyticsTable();
      }
    });
    document.getElementById('btnAnalyticsNext')?.addEventListener('click', () => {
      analyticsCurrentPage++;
      renderAnalyticsTable();
    });
    document.getElementById('btnAnalyticsLast')?.addEventListener('click', () => {
      const filtered = getFilteredAnalyticsLogs();
      analyticsCurrentPage = Math.max(1, Math.ceil(filtered.length / analyticsPageSize));
      renderAnalyticsTable();
    });

    function setupAnalyticsInterval(ms) {
      if (analyticsTimer) {
        clearInterval(analyticsTimer);
        analyticsTimer = null;
      }
      if (ms > 0) {
        analyticsTimer = setInterval(() => {
          if (activeTab === 'analytics') {
            vscode.postMessage({ command: 'fetchAnalytics', limit: analyticsLimit, page: 1 });
          }
        }, ms);
      }
    }

    const analyticsIntervalSelect = document.getElementById('analyticsIntervalSelect');
    if (analyticsIntervalSelect) {
      analyticsIntervalSelect.addEventListener('change', (e) => {
        const ms = parseInt(e.target.value, 10);
        setupAnalyticsInterval(ms);
      });
    }

    if (btnRefreshAnalytics) {
      btnRefreshAnalytics.addEventListener('click', () => {
        btnRefreshAnalytics.disabled = true;
        btnRefreshAnalytics.textContent = '⟳ Loading...';
        vscode.postMessage({ command: 'fetchAnalytics', limit: analyticsLimit, page: 1 });
      });
    }

    window.addEventListener('message', event => {
      const message = event.data;
      if (!message) return;

      if (message.command === 'switchTab' && message.tab) {
        switchTab(message.tab);
      } else if (message.command === 'consoleLogSystem' && message.message) {
        console.log('[9R-SYSTEM]', message.message);
        if (message.message.includes('[TUNNEL LIVE]')) {
          const streamBadge = document.getElementById('streamStatusBadge');
          if (streamBadge) {
            streamBadge.textContent = '● Live (Tunnel)';
            streamBadge.style.background = '#238636';
          }
        } else if (message.message.includes('[HTTP 200]')) {
          const streamBadge = document.getElementById('streamStatusBadge');
          if (streamBadge) {
            streamBadge.textContent = '● Live';
            streamBadge.style.background = '#238636';
          }
        }
        const sysLine = '[SYSTEM] ' + message.message;
        allLogLines.unshift(sysLine);
        if (allLogLines.length > consoleLogLimit) allLogLines.pop();
        renderLogs();
      } else if (message.command === 'consoleLogError') {
        const streamBadge = document.getElementById('streamStatusBadge');
        if (streamBadge) {
          streamBadge.textContent = '● Disconnected / Error';
          streamBadge.style.background = '#da3633';
        }
        const errLine = '[STREAM ERROR] ' + (message.error || 'Connection failed');
        allLogLines.unshift(errLine);
        if (allLogLines.length > consoleLogLimit) allLogLines.pop();
        renderLogs();
      } else if (message.command === 'consoleLogEvent' && message.event) {
        const streamBadge = document.getElementById('streamStatusBadge');
        if (streamBadge) {
          if (!streamBadge.textContent || !streamBadge.textContent.includes('Tunnel')) {
            streamBadge.textContent = '● Live';
          }
          streamBadge.style.background = '#238636';
        }
        const ev = message.event;
        if (ev.type === 'init') {
          allLogLines = (ev.logs || []).slice().reverse();
          if (allLogLines.length > consoleLogLimit) {
            allLogLines.length = consoleLogLimit;
          }
          consoleCurrentPage = 1;
          renderLogs();
        } else if (ev.type === 'line') {
          if (!isPaused && typeof ev.line === 'string') {
            allLogLines.unshift(ev.line);
            if (allLogLines.length > consoleLogLimit) {
              allLogLines.pop();
            }
            renderLogs();
          }
        } else if (ev.type === 'lines') {
          if (!isPaused && Array.isArray(ev.lines)) {
            for (let i = ev.lines.length - 1; i >= 0; i--) {
              allLogLines.unshift(ev.lines[i]);
            }
            if (allLogLines.length > consoleLogLimit) {
              allLogLines.length = consoleLogLimit;
            }
            renderLogs();
          }
        } else if (ev.type === 'clear') {
          allLogLines = [];
          consoleCurrentPage = 1;
          renderLogs();
        }
      } else if (message.command === 'syncData' && message.data) {
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
          refreshBtn.disabled = false;
          refreshBtn.innerHTML = '⟳ Refresh';
          refreshBtn.style.opacity = '1';
          refreshBtn.style.cursor = 'pointer';
        }
        const data = message.data;
        if (Array.isArray(data.items)) {
          data.items.forEach(item => {
            if (!item || !item.connection) return;
            const sec = document.querySelector('.provider-section[data-connection-id="' + item.connection.id + '"]');
            if (!sec || !item.usage || !item.usage.quotas) return;
            const quotas = item.usage.quotas;
            Object.entries(quotas).forEach(([name, q]) => {
              const card = sec.querySelector('.model-card[data-model="' + name.toLowerCase() + '"]');
              if (!card) return;
              const used = Number(q.used) || 0;
              const total = Number(q.total) || 0;
              const remaining = q.remaining !== undefined && q.remaining !== null ? Number(q.remaining) : Math.max(0, total - used);
              const usedPct = total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : 0;
              const remPct = total > 0 ? Math.min(100, Math.max(0, (remaining / total) * 100)) : (q.unlimited ? 100 : 0);

              card.dataset.used = String(used);
              card.dataset.total = String(total);
              card.dataset.pct = String(usedPct);
              card.dataset.remaining = String(remaining);
              if (q.resetAt) {
                card.dataset.reset = String(new Date(q.resetAt).getTime() || 0);
              }

              let barColor = 'var(--green)';
              if (usedPct >= 95) barColor = 'var(--red)';
              else if (usedPct >= 85) barColor = 'var(--yellow)';

              const progressFill = card.querySelector('.progress-fill');
              if (progressFill) {
                progressFill.style.width = usedPct + '%';
                progressFill.style.background = barColor;
              }
              const statUsed = card.querySelector('.stat-used');
              if (statUsed) {
                statUsed.textContent = formatCompactNum(used) + ' / ' + (q.unlimited ? '∞' : formatCompactNum(total)) + ' used';
              }
              const statPct = card.querySelector('.stat-pct');
              if (statPct) {
                statPct.textContent = usedPct.toFixed(1) + '%';
                statPct.style.color = barColor;
              }
              const statRem = card.querySelector('.stat-rem');
              if (statRem) {
                statRem.innerHTML = 'Remaining: <strong>' + (q.unlimited ? '∞' : formatCompactNum(remaining)) + '</strong> (' + remPct.toFixed(1) + '%)';
              }
            });
          });
          applyFiltersAndSort();
        }
      } else if (message.command === 'analyticsData') {
        if (btnRefreshAnalytics) {
          btnRefreshAnalytics.disabled = false;
          btnRefreshAnalytics.textContent = '⟳ Refresh Analytics';
        }
        if (message.stats) {
          const s = message.stats;
          const kpiReq = document.getElementById('kpi-requests');
          const kpiIn = document.getElementById('kpi-in-tokens');
          const kpiCached = document.getElementById('kpi-cached-tokens');
          const kpiOut = document.getElementById('kpi-out-tokens');
          const kpiCost = document.getElementById('kpi-cost');

          if (kpiReq) kpiReq.textContent = Number(s.totalRequests || 0).toLocaleString();
          if (kpiIn) kpiIn.textContent = formatCompactNum(s.totalPromptTokens || 0);
          if (kpiCached) kpiCached.textContent = formatCompactNum(s.totalCachedTokens || 0);
          if (kpiOut) kpiOut.textContent = formatCompactNum(s.totalCompletionTokens || 0);
          if (kpiCost) kpiCost.textContent = '$' + Number(s.totalCost || 0).toFixed(4);
        }
        if (Array.isArray(message.logs)) {
          allAnalyticsLogs = message.logs;
          renderAnalyticsTable();
        }
      }
    });

    document.getElementById('refreshBtn').addEventListener('click', () => {
      const btn = document.getElementById('refreshBtn');
      if (btn && !btn.disabled) {
        btn.disabled = true;
        btn.innerHTML = '⟳ Refreshing...';
        btn.style.opacity = '0.7';
        btn.style.cursor = 'not-allowed';
      }
      vscode.postMessage({ command: 'refresh' });
    });
    document.getElementById('setConnectionBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'setConnection' });
    });

    const statusStyleSelect = document.getElementById('statusStyleSelect');
    if (statusStyleSelect) {
      statusStyleSelect.addEventListener('change', (e) => {
        vscode.postMessage({ command: 'updateStatusStyle', statusMode: e.target.value });
      });
    }

    const tooltipStyleSelect = document.getElementById('tooltipStyleSelect');
    if (tooltipStyleSelect) {
      tooltipStyleSelect.addEventListener('change', (e) => {
        vscode.postMessage({ command: 'updateTooltipStyle', tooltipMode: e.target.value });
      });
    }

    const refreshIntervalSelect = document.getElementById('refreshIntervalSelect');
    if (refreshIntervalSelect) {
      refreshIntervalSelect.addEventListener('change', (e) => {
        vscode.postMessage({
          command: 'updateRefreshInterval',
          intervalSeconds: parseInt(e.target.value, 10)
        });
      });
    }

    document.addEventListener('click', (e) => {
      const pinAccBtn = e.target.closest('.pinned-account-btn, .pin-account-btn');
      if (pinAccBtn) {
        const accountId = pinAccBtn.dataset.accountId;
        if (accountId) {
          vscode.postMessage({ command: 'togglePinAccount', accountId: accountId });
        }
        return;
      }
      const toggleBtn = e.target.closest('.toggle-btn');
      if (toggleBtn) {
        const connId = toggleBtn.dataset.connectionId;
        const currentActive = toggleBtn.dataset.active === 'true';
        if (connId) {
          vscode.postMessage({
            command: 'toggleProviderActive',
            connectionId: connId,
            newActive: !currentActive
          });
        }
        return;
      }
      const starBtn = e.target.closest('.star-btn, .pin-btn');
      if (starBtn) {
        const model = starBtn.dataset.model;
        if (model) {
          vscode.postMessage({ command: 'togglePinModel', modelName: model });
        }
        return;
      }
      const hideBtn = e.target.closest('.hide-btn');
      if (hideBtn) {
        const model = hideBtn.dataset.model;
        if (model) {
          vscode.postMessage({ command: 'toggleHide', model: model });
        }
        return;
      }
    });

    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        activeFilter = chip.dataset.filter;
        vscode.postMessage({ command: 'updateFilter', filter: activeFilter });
        applyFiltersAndSort();
      });
    });

    searchInput.addEventListener('input', () => {
      applyFiltersAndSort();
    });

    sortSelect.addEventListener('change', () => {
      vscode.postMessage({ command: 'updateSort', sort: sortSelect.value });
      applyFiltersAndSort();
    });

    showHiddenCheck.addEventListener('change', () => {
      applyFiltersAndSort();
    });

    function applyFiltersAndSort() {
      const query = (searchInput.value || '').trim().toLowerCase();
      const showHidden = showHiddenCheck.checked;
      const sortMode = sortSelect.value;
      const isProviderFilter = activeFilter.startsWith('provider:');
      const targetProvider = isProviderFilter ? activeFilter.replace('provider:', '') : null;

      const container = document.getElementById('sectionsContainer');
      const sections = Array.from(document.querySelectorAll('.provider-section'));

      sections.forEach(section => {
        const prov = (section.dataset.provider || '').toLowerCase();
        const accName = (section.dataset.name || '').toLowerCase();

        if (targetProvider && prov !== targetProvider) {
          section.style.display = 'none';
          return;
        }
        section.style.display = '';

        const grid = section.querySelector('.models-grid');
        if (!grid) return;
        const cards = Array.from(grid.querySelectorAll('.model-card'));
        let visibleCount = 0;

        cards.forEach(card => {
          const model = card.dataset.model || '';
          const title = card.dataset.title || '';
          const used = parseFloat(card.dataset.used || '0');
          const isHidden = card.dataset.hidden === 'true';

          const matchesSearch = !query || model.includes(query) || title.includes(query) || accName.includes(query) || prov.includes(query);
          let matchesCategory = true;
          if (activeFilter === 'active') {
            matchesCategory = used > 0;
          } else if (activeFilter === 'claude') {
            matchesCategory = model.includes('claude') || title.includes('claude');
          } else if (activeFilter === 'gemini') {
            matchesCategory = model.includes('gemini') || title.includes('gemini');
          } else if (activeFilter === 'other') {
            matchesCategory = !model.includes('claude') && !title.includes('claude') && !model.includes('gemini') && !title.includes('gemini');
          }

          const matchesHidden = showHidden || !isHidden;

          if (matchesSearch && matchesCategory && matchesHidden) {
            card.style.display = '';
            visibleCount++;
          } else {
            card.style.display = 'none';
          }
        });

        cards.sort((a, b) => {
          if (sortMode === 'used_desc') {
            return parseFloat(b.dataset.pct || '0') - parseFloat(a.dataset.pct || '0');
          }
          if (sortMode === 'used_asc') {
            return parseFloat(a.dataset.pct || '0') - parseFloat(b.dataset.pct || '0');
          }
          if (sortMode === 'remaining_desc') {
            return parseFloat(b.dataset.remaining || '0') - parseFloat(a.dataset.remaining || '0');
          }
          if (sortMode === 'name_asc') {
            return (a.dataset.title || '').localeCompare(b.dataset.title || '');
          }
          if (sortMode === 'reset_asc') {
            const ra = parseFloat(a.dataset.reset || '0');
            const rb = parseFloat(b.dataset.reset || '0');
            if (ra === 0) return 1;
            if (rb === 0) return -1;
            return ra - rb;
          }
          return 0;
        });

        cards.forEach(card => grid.appendChild(card));

        const notice = section.querySelector('.empty-grid-notice');
        if (notice) {
          notice.style.display = visibleCount === 0 ? 'block' : 'none';
        }
      });

      if (container) {
        if (sortMode === 'provider_asc') {
          sections.sort((a, b) => (a.dataset.provider || '').localeCompare(b.dataset.provider || ''));
          sections.forEach(s => container.appendChild(s));
        } else if (sortMode === 'account_asc') {
          sections.sort((a, b) => (a.dataset.name || '').localeCompare(b.dataset.name || ''));
          sections.forEach(s => container.appendChild(s));
        }
      }
    }

    applyFiltersAndSort();
  `;
}
