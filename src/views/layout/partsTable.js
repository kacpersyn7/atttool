/**
 * Layout workspace, "Table" view: every part of the satellite in one sortable, filterable
 * table (position, axis, yaw-pitch-roll, mass, parameters, angles in nominal flight), with
 * expandable rows (DCM, quaternion), warnings and a spreadsheet copy. Read-only; "Edit"
 * jumps to the part editor in the 3D view.
 */
import * as AM from '../../core/attitude.js';
import { formatMatlab } from '../../core/matrixText.js';
import { S, save } from '../../state/store.js';
import { h } from '../../ui/dom.js';
import { copyText } from '../../ui/overlay.js';
import { fmt } from '../../ui/format.js';
import { TYPES } from '../../spacecraft/componentTypes.js';
import { massProps } from '../../spacecraft/massProperties.js';
import { partRows, layoutWarnings, rowsToTSV } from '../../spacecraft/partsTable.js';
import { codeName } from '../../spacecraft/orientationImport.js';
import { specOf } from '../../spacecraft/alignment.js';

const n1 = x => fmt(x, 1), n2 = x => fmt(x, 2), n3 = x => fmt(x, 3);
const axisText = a => { const s = specOf(a.map(x => Math.abs(Math.abs(x) - 1) < 1e-9 ? Math.sign(x) : Math.abs(x) < 1e-9 ? 0 : x)); return s ? s.replace('-', '−') : '[' + a.map(n2).join(' ') + ']'; };

/** Column definitions: key, header, group, value for sorting, cell text, numeric? */
const COLS = [
  { key: 'name', head: 'Part', val: r => r.name.toLowerCase(), cell: r => r.name },
  { key: 'type', head: 'Type', val: r => r.typeLabel, cell: r => r.typeLabel },
  { key: 'x', head: 'x', group: 'Position in SCF (m)', num: 1, val: r => r.pos[0], cell: r => n3(r.pos[0]) },
  { key: 'y', head: 'y', group: 1, num: 1, val: r => r.pos[1], cell: r => n3(r.pos[1]) },
  { key: 'z', head: 'z', group: 1, num: 1, val: r => r.pos[2], cell: r => n3(r.pos[2]) },
  { key: 'axis', head: '+Z axis in SCF', val: r => axisText(r.axis), cell: r => h('span', { title: r.axisLabel }, axisText(r.axis)) },
  { key: 'yaw', head: 'yaw', group: 'Yaw-pitch-roll (°)', num: 1, val: r => r.ypr[0], cell: r => n1(r.ypr[0]) },
  { key: 'pitch', head: 'pitch', group: 1, num: 1, val: r => r.ypr[1], cell: r => n1(r.ypr[1]) },
  { key: 'roll', head: 'roll', group: 1, num: 1, val: r => r.ypr[2], cell: r => n1(r.ypr[2]) },
  { key: 'mass', head: 'Mass kg', num: 1, val: r => r.mass, cell: r => n2(r.mass) },
  { key: 'params', head: 'Parameters', val: r => r.params, cell: r => r.params },
  { key: 'earth', head: 'Earth', group: 'Axis angle in nominal flight (°)', num: 1, val: r => r.toEarth, cell: r => n1(r.toEarth) },
  { key: 'along', head: 'along', group: 1, num: 1, val: r => r.toAlong, cell: r => n1(r.toAlong) },
  { key: 'normal', head: 'normal', group: 1, num: 1, val: r => r.toNormal, cell: r => n1(r.toNormal) },
];

/**
 * @param el container element (an overlay inside the viewport)
 * @param o { onEdit(id), viewToggle(): Node, onImport() }
 */
export function createPartsTable(el, { onEdit, viewToggle, onImport }) {
  const open = new Set(); // expanded rows (not persisted)
  const T = () => S.layout.table;
  // decimal comma: the user's choice, else whatever the browser locale uses
  const localeComma = (() => { try { return new Intl.NumberFormat(navigator.language).format(1.5).includes(','); } catch { return false; } })();
  const useComma = () => (T().comma ?? localeComma);
  const commaBox = () => { const b = h('input', { type: 'checkbox' }); b.checked = useComma(); b.addEventListener('change', () => { T().comma = b.checked; save(); }); return b; };

  function render() {
    const t = T(), sc = S.sc, all = partRows(sc), warns = layoutWarnings(sc);
    const warnIds = new Set(warns.filter(w => w.level === 'warn').flatMap(w => w.ids));
    const q = t.q.trim().toLowerCase();
    let rows = all.filter(r => (t.type === 'all' || r.type === t.type) && (!q || r.name.toLowerCase().includes(q) || r.typeLabel.toLowerCase().includes(q)));
    const col = COLS.find(c => c.key === t.sort);
    if (col) rows = rows.slice().sort((a, b) => { const x = col.val(a), y = col.val(b); return (x < y ? -1 : x > y ? 1 : 0) * t.dir; });

    const types = ['all', 'bus', ...Object.keys(TYPES).filter(k => sc.comps.some(c => c.type === k))];
    const typeSel = h('select', { 'aria-label': 'Filter by type' }, types.map(k => h('option', { value: k, selected: k === t.type }, k === 'all' ? 'All types' : k === 'bus' ? 'Bus' : TYPES[k].label)));
    typeSel.addEventListener('change', () => { t.type = typeSel.value; save(); render(); });
    const search = h('input', { type: 'text', placeholder: 'Search name…', value: t.q, 'aria-label': 'Search parts' });
    search.addEventListener('input', () => { t.q = search.value; save(); render(); const s = el.querySelector('input[type=text]'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); });

    const sortBy = key => { if (t.sort === key) t.dir = -t.dir; else { t.sort = key; t.dir = 1; } save(); render(); };
    const groupRow = []; // header row 1: groups spanning their columns
    for (let i = 0; i < COLS.length; i++) {
      const c = COLS[i];
      if (typeof c.group === 'string') { let span = 1; while (COLS[i + span] && COLS[i + span].group === 1) span++; groupRow.push(h('th', { colspan: span, class: 'grp' }, c.group)); i += span - 1; }
      else groupRow.push(h('th', null));
    }
    groupRow.push(h('th', null));
    const headRow = COLS.map(c => h('th', { class: (c.num ? 'num ' : '') + (t.sort === c.key ? 'sorted' : ''), 'aria-sort': t.sort === c.key ? (t.dir > 0 ? 'ascending' : 'descending') : null },
      h('button', { type: 'button', onclick: () => sortBy(c.key) }, c.head, t.sort === c.key ? (t.dir > 0 ? ' ▲' : ' ▼') : '')));
    headRow.push(h('th', null));

    const body = [];
    for (const r of rows) {
      const isOpen = open.has(r.id);
      const tr = h('tr', { class: [r.id === S.layout.sel ? 'sel' : '', warnIds.has(r.id) ? 'warnrow' : '', isOpen ? 'open' : ''].join(' ').trim(), onclick: e => { if (e.target.closest('button')) return; isOpen ? open.delete(r.id) : open.add(r.id); render(); } },
        COLS.map(c => h('td', { class: c.num ? 'num' : c.key === 'name' ? 'name' : '' },
          c.key === 'name' ? [h('span', { class: 'tw' }, isOpen ? '▾' : '▸'), h('i', { class: 'sw', style: 'background:' + (r.type === 'bus' ? '#c99a3e' : TYPES[r.type].color) }), r.name] : c.cell(r))),
        h('td', null, h('button', { class: 'btn', onclick: () => onEdit(r.id), title: 'Select it and open the part editor in the 3D view' }, 'Edit')));
      body.push(tr);
      if (isOpen) {
        const nm = r.id === 'bus' ? 'bus' : codeName(r.name);
        const ml = r.id === 'bus'
          ? `bus_pos_B = [${r.pos.map(x => +x.toFixed(6)).join(' ')}];\nbus_C_SG = ${formatMatlab(AM.m.T(r.C), 9)};`
          : `${nm}_pos_B = [${r.pos.map(x => +x.toFixed(6)).join(' ')}];\n${nm}_C_CB = ${formatMatlab(r.C, 9)};\n${nm}_q_BC = [${[r.q.w, r.q.x, r.q.y, r.q.z].map(x => +x.toFixed(9)).join(' ')}];`;
        body.push(h('tr', { class: 'detail' }, h('td', { colspan: COLS.length + 1 },
          h('div', { class: 'detail-grid' },
            h('div', null, h('div', { class: 'lbl' }, r.id === 'bus' ? 'C_GS (SCF → box), rows = box axes in SCF' : 'C_CB (SCF → part), rows = part axes in SCF'),
              h('div', { class: 'mat' }, r.C.flat().map(x => h('div', null, fmt(x, 4))))),
            h('div', null, h('div', { class: 'lbl' }, 'MATLAB'), h('pre', null, ml),
              h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => copyText(ml, r.name + ' (MATLAB)') }, 'Copy'))),
            h('div', { class: 'kv' },
              h('dt', null, 'q [q₀ q₁ q₂ q₃]'), h('dd', null, [r.q.w, r.q.x, r.q.y, r.q.z].map(x => fmt(x, 5)).join(' ')),
              h('dt', null, 'Axis'), h('dd', null, r.axisLabel + ' [' + r.axis.map(x => fmt(x, 4)).join(', ') + ']'),
              r.params ? [h('dt', null, 'Parameters'), h('dd', null, r.params)] : null)))));
      }
    }

    const MP = massProps(sc);
    el.innerHTML = '';
    el.append(
      h('div', { class: 'ptable-bar' }, viewToggle(), typeSel, search,
        h('span', { class: 'lbl' }, `${rows.length} of ${all.length} parts`), h('span', { class: 'hspace' }),
        h('label', { class: 'chk', title: 'Use decimal commas (e.g. Polish or German Excel). Import reads both.' }, commaBox(), 'Decimal comma'),
        h('button', { class: 'btn', onclick: () => copyText(rowsToTSV(rows, { comma: useComma() }), 'Table') }, 'Copy table (for Excel)'),
        h('button', { class: 'btn', onclick: onImport, title: 'Paste the table back after editing it in Excel; you get a preview first' }, 'Import edits…')),
      h('div', { class: 'ptable-scroll' }, h('table', { class: 'parts' },
        h('thead', null, h('tr', { class: 'groups' }, groupRow), h('tr', null, headRow)),
        h('tbody', null, body.length ? body : h('tr', null, h('td', { colspan: COLS.length + 1, class: 'empty' }, 'No parts match the filter.'))))),
      h('div', { class: 'ptable-foot' },
        h('div', { class: 'kv' },
          h('dt', null, 'Total mass'), h('dd', null, MP.M.toFixed(2) + ' kg'),
          h('dt', null, 'CoM in SCF'), h('dd', null, '[' + MP.com.map(n3).join(', ') + '] m'),
          h('dt', null, 'Nominal flight'), h('dd', null, `${sc.align.ref.toUpperCase()} · angles between each part's +Z axis and Earth (nadir), along-track and the orbit normal; circular orbit`)),
        h('div', null,
          warns.length ? h('ul', { class: 'warns' }, warns.map(w => h('li', { class: w.level }, w.text))) : h('p', { class: 'tip' }, 'No layout warnings.'),
          h('p', { class: 'tip' }, 'To edit many parts at once: Copy table → edit positions, masses or angles in Excel → Import edits. You get a preview before anything changes.'))));
  }
  return { render };
}
