export function formatCompact(n: number): string {
  if (n >= 1_000_000) {
    return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  }
  if (n >= 1_000) {
    return (n / 1_000).toFixed(1).replace(/\.?0+$/, '') + 'K';
  }
  return String(n);
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString();
}

export function formatResetCompact(iso?: string): string {
  if (!iso) {
    return '';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) {
    return timeStr;
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${timeStr}`;
}

export function renderTextBar(pct: number, width = 8): string {
  const clamped = Math.min(100, Math.max(0, pct));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  return '■'.repeat(filled) + '□'.repeat(empty);
}

export function getHealthIcon(remPct: number): string {
  if (remPct <= 5) return '🔴';
  if (remPct <= 15) return '🟡';
  return '🟢';
}

export function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderBar(pct: number, width = 40): string {
  const clamped = Math.min(100, Math.max(0, pct));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;

  let color = '#3fb950';
  if (clamped >= 95) {
    color = '#f85149';
  } else if (clamped >= 85) {
    color = '#d29922';
  }

  const unit = '&nbsp;';
  const filledBar =
    filled > 0
      ? `<span style="background-color:${color};">${unit.repeat(filled)}</span>`
      : '';
  const emptyBar =
    empty > 0
      ? `<span style="background-color:#3a3f47;">${unit.repeat(empty)}</span>`
      : '';
  return filledBar + emptyBar;
}
