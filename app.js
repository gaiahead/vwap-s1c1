const GRID = '#1e2535';
const TICK = '#475569';

const STRUCT_LABELS = [
  '200d','190d','180d','170d','160d','150d','140d','130d','120d','110d',
  '100d','90d','80d','70d','60d','50d','40d','30d','20d','10d'
];

const GROUP_ORDER = ['g1', 'g2', 'g3'];

let structChart;
let activeSet = new Set(['TLT']);

function rankColor(t) {
  let R, G, B;
  if (t >= 0.5) {
    const s = (t - 0.5) * 2;
    R = 107 + (34 - 107) * s;
    G = 114 + (197 - 114) * s;
    B = 128 + (94 - 128) * s;
  } else {
    const s = t * 2;
    R = 239 + (107 - 239) * s;
    G = 68 + (114 - 68) * s;
    B = 68 + (128 - 68) * s;
  }
  return `rgb(${Math.round(R)}, ${Math.round(G)}, ${Math.round(B)})`;
}

function calcColors(names, data) {
  const vals = names.map(n => data[n]?.vwap_structure?.[0]?.norm ?? 0);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const colors = {};
  names.forEach((n, i) => {
    const t = (vals[i] - min) / range;
    colors[n] = rankColor(t);
  });
  return colors;
}

fetch('trend_data.json')
  .then(r => r.json())
  .then(data => {
    const allNames = Object.keys(data).filter(k => k !== '_meta');
    const namesByGroup = {};
    GROUP_ORDER.forEach(g => { namesByGroup[g] = []; });
    allNames.forEach(n => {
      const g = data[n].group;
      if (namesByGroup[g]) namesByGroup[g].push(n);
    });

    document.getElementById('updated').textContent = data._meta.updated_at + ' 기준';

    const SCI_DECAY = 0.75;
    const SCI_THRESHOLD = 0.01;

    function get10d(name) {
      return data[name]?.vwap_structure?.[0]?.norm ?? null;
    }

    function calcSCI(name) {
      const vs = data[name]?.vwap_structure;
      if (!vs) return null;
      const vmap = {};
      vs.forEach(s => { vmap[s.window] = s.vwap; });
      if (!vmap[10] || !vmap[200]) return null;

      const weights = [];
      for (let i = 0; i < 10; i++) weights.push(10 * Math.pow(SCI_DECAY, i));

      const rowScores = [];
      for (let i = 0; i < 10; i++) {
        const endpoint = (i + 1) * 10;
        let pass = 0, total = 0;
        for (let j = 1; j <= 10; j++) {
          const start = endpoint + j * 10;
          if (vmap[start] == null) continue;
          if (vmap[endpoint] == null) continue;
          total++;
          const slope = (vmap[endpoint] - vmap[start]) / j;
          if (slope > vmap[endpoint] * SCI_THRESHOLD) pass++;
        }
        rowScores.push(total === 0 ? 0 : pass / total);
      }

      let wSum = 0, wTotal = 0;
      weights.forEach((w, i) => { wSum += w * rowScores[i]; wTotal += w; });
      return { sci: wSum / wTotal, rowScores };
    }

    function renderSCI() {
      const targets = ['삼성전자', 'SK하이닉스', '한미반도체', '리노공업'];
      if (!targets.some(t => data[t])) return;
      document.getElementById('sci-section').style.display = '';

      const rows = [];
      allNames.forEach(name => {
        const result = calcSCI(name);
        if (result) rows.push({ name, ...result });
      });
      rows.sort((a, b) => b.sci - a.sci);

      const tbody = document.getElementById('sci-body');
      tbody.innerHTML = '';
      rows.forEach(row => {
        const tr = document.createElement('tr');
        const sciColor = row.sci >= 0.8 ? '#4ade80' : row.sci >= 0.6 ? '#94a3b8' : '#f87171';
        let html = `<td>${row.name}</td>`;
        html += `<td style="color:${sciColor};font-weight:700">${row.sci.toFixed(3)}</td>`;
        row.rowScores.forEach(s => {
          const c = s >= 0.8 ? '#4ade80' : s >= 0.5 ? '#94a3b8' : '#475569';
          html += `<td style="color:${c}">${(s * 10).toFixed(0)}/10</td>`;
        });
        tr.innerHTML = html;
        tbody.appendChild(tr);
      });
    }

    function renderCards() {
      const colors = calcColors(allNames, data);
      const groupsEl = document.getElementById('groups');
      groupsEl.innerHTML = '';

      GROUP_ORDER.forEach(g => {
        const names = namesByGroup[g];
        if (!names || names.length === 0) return;
        const groupDiv = document.createElement('div');
        groupDiv.className = 'group';

        names.forEach(name => {
          const color = colors[name];
          const isActive = activeSet.has(name);
          const v10 = get10d(name);
          const btn = document.createElement('div');
          btn.className = 'asset-btn' + (isActive ? ' active' : '');
          btn.style.setProperty('--c', color);

          const sciResult = calcSCI(name);
          const sciStr = sciResult ? `SCI ${sciResult.sci.toFixed(3)}` : '';

          btn.innerHTML =
            `<div class="indicator"></div>` +
            `<div class="name">${name}</div>` +
            `<div class="val" style="color:${color}">${v10 != null ? v10.toFixed(2) : '–'}</div>` +
            `<div class="sci">${sciStr}</div>`;

          btn.addEventListener('click', () => {
            if (activeSet.has(name)) activeSet.delete(name);
            else activeSet.add(name);
            renderCards();
            updateChart();
          });

          groupDiv.appendChild(btn);
        });
        groupsEl.appendChild(groupDiv);
      });
    }

    function makeDatasets() {
      const colors = calcColors(allNames, data);
      return allNames.map(name => {
        const color = colors[name];
        const isActive = activeSet.has(name);
        const reversed = [...(data[name]?.vwap_structure || [])].reverse();
        return {
          label: name,
          data: reversed.map(s => s.norm),
          rawVwap: reversed.map(s => s.vwap),
          borderColor: color,
          borderWidth: isActive ? 2 : 0,
          pointRadius: isActive ? 3 : 0,
          pointHoverRadius: isActive ? 4 : 0,
          pointBackgroundColor: color,
          tension: 0.3,
          fill: false,
          hidden: !isActive,
        };
      });
    }

    function makeAnnotations() {
      const colors = calcColors(allNames, data);
      const annotations = {
        base: {
          type: 'line',
          yMin: 100,
          yMax: 100,
          borderColor: '#475569',
          borderWidth: 1.5,
        }
      };

      const active = allNames
        .filter(n => activeSet.has(n))
        .map(n => ({ name: n, val: get10d(n) }))
        .filter(o => o.val != null)
        .sort((a, b) => b.val - a.val);

      active.forEach(({ name, val }) => {
        annotations['lbl_' + name] = {
          type: 'label',
          xValue: 19,
          yValue: val,
          content: name + ' ' + val.toFixed(2),
          color: colors[name],
          font: { size: 10, weight: 'bold' },
          backgroundColor: 'rgba(15,17,23,0.85)',
          padding: { x: 4, y: 2 },
          position: { x: 'start', y: 'center' },
          xAdjust: 4,
        };
      });

      return annotations;
    }

    function updateChart() {
      structChart.data.datasets = makeDatasets();
      structChart.options.plugins.annotation.annotations = makeAnnotations();
      structChart.update('none');
    }

    renderCards();
    renderSCI();

    structChart = new Chart(document.getElementById('chart-structure'), {
      type: 'line',
      data: {
        labels: STRUCT_LABELS,
        datasets: makeDatasets(),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        interaction: { mode: 'index', intersect: false },
        layout: { padding: 0 },
        plugins: {
          legend: { display: false },
          annotation: { annotations: makeAnnotations() },
          tooltip: {
            callbacks: {
              label: ctx => {
                const norm = ctx.parsed.y?.toFixed(2);
                const raw = ctx.dataset.rawVwap?.[ctx.dataIndex];
                const rawStr = raw != null
                  ? raw.toLocaleString(undefined, { maximumFractionDigits: 2 })
                  : '–';
                return ` ${ctx.dataset.label}: ${norm} (VWAP ${rawStr})`;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: TICK, font: { size: 10 } },
            grid: { color: GRID },
          },
          y: {
            ticks: {
              color: TICK,
              font: { size: 10 },
              count: 11,
              callback: v => v.toFixed(2),
            },
            grid: { color: GRID },
            afterDataLimits(scale) {
              if (activeSet.size === 0) {
                scale.min = 100;
                scale.max = 200;
              }
            }
          }
        }
      }
    });

    function resizeChart() {
      const wrap = document.querySelector('.chart-wrap');
      const h = Math.max(300, Math.min(420, window.innerHeight * 0.45));
      wrap.style.height = h + 'px';
      structChart.resize();
    }

    resizeChart();
    window.addEventListener('resize', resizeChart);
  });

(function() {
  const decay = 0.75;
  const weights = [];
  for (let i = 0; i < 10; i++) weights.push(+(10 * Math.pow(decay, i)).toFixed(4));
  const total = weights.reduce((a, b) => a + b, 0);

  const tbody = document.getElementById('sci-weight-table');
  if (!tbody) return;

  weights.forEach((w, i) => {
    const endpoint = (i + 1) * 10;
    const percent = (w / total * 100).toFixed(2);
    const barW = Math.round(w / total * 120);
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td style="padding:4px 12px;color:#94a3b8">${endpoint}d</td>` +
      `<td style="padding:4px 12px;text-align:right;color:#cbd5e1">${w.toFixed(4)}</td>` +
      `<td style="padding:4px 12px;text-align:right;color:#60a5fa">${percent}%</td>` +
      `<td style="padding:4px 12px 4px 16px;color:#334155">` +
        `<span style="display:inline-block;width:${barW}px;height:8px;background:#1e3a5f;border-radius:2px;vertical-align:middle;margin-right:6px"></span>` +
        `${endpoint + 10}d ~ ${endpoint + 100}d` +
      `</td>`;
    tbody.appendChild(tr);
  });

  const first5 = weights.slice(0, 5).reduce((a, b) => a + b, 0);
  const last5 = weights.slice(5).reduce((a, b) => a + b, 0);
  const sumTr = document.createElement('tr');
  sumTr.innerHTML =
    `<td style="padding:4px 12px;border-top:1px solid #1e2535;font-weight:600">합계</td>` +
    `<td style="padding:4px 12px;text-align:right;border-top:1px solid #1e2535;font-weight:600">${total.toFixed(4)}</td>` +
    `<td style="padding:4px 12px;text-align:right;border-top:1px solid #1e2535;font-weight:600">100.00%</td>` +
    `<td style="padding:4px 12px 4px 16px;border-top:1px solid #1e2535;font-weight:600">10~50d: ${(first5 / total * 100).toFixed(1)}% / 60~100d: ${(last5 / total * 100).toFixed(1)}%</td>`;
  tbody.appendChild(sumTr);
})();
