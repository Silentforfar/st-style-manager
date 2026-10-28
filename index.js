/**
 * 文风管理器（st-style-manager）
 *
 * 思路：把喜欢的文风当成一个个「标签」存进盒子。
 * 点标签即点亮，可以同时点亮多个；点亮顺序决定拼接顺序。
 * 预设里只写一个宏 {{style}}，它返回所有点亮文风的组合正文——
 * 所以换风格只要在面板上点几下，不用动预设。
 */

import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced, substituteParams } from '../../../../script.js';
import { macros, MacroCategory } from '../../../macros/macro-system.js';

const TAG = '[文风]';
const VERSION = 'v2.3.1';
const JOINER = '\n\n';

// ---------------- 内置示例文风（首次安装时种子） ----------------

const DEFAULT_ZH = [
	{
		name: '冷峻克制',
		tags: '内置,极简,白描',
		content: [
			'叙事用第三人称限知，语气冷峻，不写抒情与感叹。',
			'句子偏短，多用陈述句；动词优先，形容词节制，避免「美丽」「动人」这类泛化修饰。',
			'环境只写可观察的细节（光、声音、温度、材质），不直接写人物心理。',
			'对话简短，允许答非所问；情绪靠动作与停顿透露。',
			'禁忌：堆叠「仿佛」「似乎」式比喻，不写总结性的感悟句。',
		].join('\n'),
	},
	{
		name: '细腻感官',
		tags: '内置,感官,意象',
		content: [
			'近距离第三人称，镜头贴近人物：先写身体感受，再写情绪。',
			'调动五感，一段只突出一种（气味或触感优先），意象要具体，不写抽象形容。',
			'句子长短交替，描写段落可以慢下来，但每句都要带来新信息。',
			'比喻取自日常物件，同一场景内不重复同一个喻体。',
			'禁忌：形容词堆砌、与情节无关的天气铺陈。',
		].join('\n'),
	},
	{
		name: '古典雅正',
		tags: '内置,文言,典雅',
		content: [
			'叙事用半文半白，句式凝练，避免现代口语与网络词。',
			'重意象与留白；用典节制，一章不超过一处，且不解释典故。',
			'对话简省，多用短句、常省略主语；称谓符合时代习惯。',
			'情绪藏在景物与动作里，不作直接说明。',
			'禁忌：生造古语、文言虚词滥用（之乎者也不连用）。',
		].join('\n'),
	},
	{
		name: '轻快幽默',
		tags: '内置,口语,幽默',
		content: [
			'第一人称或贴身第三人称，语速快，句子短，允许口语与插入语。',
			'幽默来自观察与自嘲，不用网络烂梗，不靠感叹号制造热闹。',
			'对话密集，允许抢话、答非所问、故意误解。',
			'严肃时刻突然收住，用一句平实的话落地，反差即笑点。',
			'禁忌：连续三段都在抖机灵，读者会疲劳。',
		].join('\n'),
	},
	{
		name: '悬疑压迫',
		tags: '内置,悬疑,节奏',
		content: [
			'限制视角：只写主角此刻能感知到的信息，读者与主角同步缺信息。',
			'句子短促，多用断句与独立成段；环境音被放大，视野被收窄。',
			'延迟给出关键信息：先写异常结果，再慢慢补原因。',
			'对话里允许谎言与回避，不写「他知道一切」式旁白。',
			'禁忌：提前解释动机、用形容词直接宣布「恐怖」。',
		].join('\n'),
	},
];

// 只做中文（2026-10-28 主人决定：不发多语言，避免维护两套文案）
function defaultSet() {
	return DEFAULT_ZH;
}

// ---------------- 数据 ----------------

function store() {
	if (!extension_settings.styleManager || typeof extension_settings.styleManager !== 'object') {
		extension_settings.styleManager = { version: 2, styles: [], selectedIds: [] };
	}
	const s = extension_settings.styleManager;
	if (!Array.isArray(s.styles)) { s.styles = []; }
	if (!Array.isArray(s.selectedIds)) {
		// 旧版（单选 activeId）平滑迁移
		s.selectedIds = s.activeId ? [s.activeId] : [];
	}
	s.selectedIds = s.selectedIds.filter((id) => s.styles.some((x) => x.id === id));
	s.version = 2;
	return s;
}

function uid() {
	return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function selectedStyles() {
	const s = store();
	const map = new Map(s.styles.map((x) => [x.id, x]));
	return s.selectedIds.map((id) => map.get(id)).filter(Boolean);
}

/** 组合所有点亮的文风（顺序 = 点亮顺序） */
function composeStyle() {
	return selectedStyles()
		.map((x) => (x.content || '').trim())
		.filter(Boolean)
		.join(JOINER);
}

function persist() {
	saveSettingsDebounced();
}

/**
 * 写入内置示例文风（按名称去重，绝不覆盖用户已有内容）。
 * @returns {number} 实际新增条数
 */
function seedDefaults() {
	const s = store();
	let added = 0;
	for (const d of defaultSet()) {
		if (s.styles.some((x) => x.name === d.name)) { continue; }
		s.styles.push({
			id: uid(),
			name: d.name,
			tags: d.tags || '',
			content: d.content,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		added++;
	}
	if (added > 0) { persist(); }
	return added;
}

/** 首次安装时种一次；用户删光了也不会再自动塞回去（seeded 标记） */
function ensureSeeded() {
	const s = store();
	if (s.seeded) { return; }
	s.seeded = true;
	const added = seedDefaults();
	// 全新安装时顺手点亮第一条，让 {{style}} 立刻有内容，而不是一片空白
	if (added > 0 && s.selectedIds.length === 0 && s.styles.length > 0) {
		s.selectedIds.push(s.styles[0].id);
	}
	persist();
}

// ---------------- 宏 ----------------

function registerMacros() {
	try {
		const payload = {
			description: '所有点亮的文风组合后的正文（在面板上点标签选择，可多选）',
			returns: '组合正文；没有点亮任何文风时为空',
			handler: () => composeStyle(),
		};
		if (MacroCategory && MacroCategory.STATE) { payload.category = MacroCategory.STATE; }
		const r = macros.register('style', payload);
		if (!r) { console.warn(TAG, '宏 style 注册被拒绝（详见控制台）'); }
	} catch (err) {
		console.warn(TAG, '宏注册异常', err);
	}
}

// ---------------- 界面 ----------------

let panel;
let floatWin;
let editingId = null;
let query = '';

const CSS = `
#stsm{color:inherit;margin-bottom:10px;position:relative}
#stsm .stsm-head{display:flex;align-items:center;gap:8px;width:100%}
#stsm .stsm-summary{margin-left:auto;font-size:11.5px;opacity:.6;font-weight:400;
 max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#stsm .stsm-chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 8px;
 max-height:104px;overflow-y:auto;overscroll-behavior:contain;padding-right:2px}
#stsm .stsm-chips::-webkit-scrollbar{width:8px}
#stsm .stsm-chips::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--SmartThemeBodyColor,#fff) 18%,transparent);border-radius:4px}
#stsm .stsm-chips::-webkit-scrollbar-track{background:transparent}
.stsm-chip{font-size:12.5px;padding:4px 10px;border-radius:999px;cursor:pointer;user-select:none;
 border:1px solid color-mix(in srgb,var(--SmartThemeBodyColor,#fff) 22%,transparent);
 background:color-mix(in srgb,var(--SmartThemeBodyColor,#fff) 5%,transparent);
 color:inherit;opacity:.85;transition:background .15s,border-color .15s,opacity .15s;max-width:100%;
 overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stsm-chip:hover{opacity:1;border-color:color-mix(in srgb,var(--SmartThemeBodyColor,#fff) 40%,transparent)}
.stsm-chip.stsm-lit{
 border-color:var(--SmartThemeQuoteColor,#2f9e62);
 background:color-mix(in srgb,var(--SmartThemeQuoteColor,#2f9e62) 26%,transparent);
 opacity:1;font-weight:600}
.stsm-chip.stsm-lit::before{content:"✓ ";font-weight:700}
#stsm .stsm-bar{display:flex;gap:6px;align-items:center;margin:6px 0;flex-wrap:wrap}
#stsm input,#stsm textarea,#stse input,#stse textarea{background:color-mix(in srgb,var(--SmartThemeBodyColor,#fff) 8%,transparent);
 border:1px solid color-mix(in srgb,var(--SmartThemeBodyColor,#fff) 18%,transparent);
 color:inherit;border-radius:6px;padding:3px 7px;font-size:12px;font-family:inherit}
#stsm button,#stse button{background:color-mix(in srgb,var(--SmartThemeBodyColor,#fff) 10%,transparent);
 border:1px solid color-mix(in srgb,var(--SmartThemeBodyColor,#fff) 18%,transparent);color:inherit;
 border-radius:6px;padding:3px 9px;font-size:12px;cursor:pointer;white-space:nowrap}
#stsm button:hover,#stse button:hover{background:color-mix(in srgb,var(--SmartThemeBodyColor,#fff) 18%,transparent)}
#stsm input.stsm-search{flex:1 1 150px;min-width:100px}
#stsm .stsm-count{font-size:11.5px;opacity:.55;white-space:nowrap;margin-left:auto}
#stsm .stsm-list{max-height:200px;overflow-y:auto;overscroll-behavior:contain}
#stsm .stsm-list::-webkit-scrollbar{width:8px}
#stsm .stsm-list::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--SmartThemeBodyColor,#fff) 18%,transparent);border-radius:4px}
#stsm .stsm-list::-webkit-scrollbar-track{background:transparent}
#stsm .stsm-item{display:flex;align-items:center;gap:8px;padding:5px 0;
 border-bottom:1px solid color-mix(in srgb,var(--SmartThemeBodyColor,#fff) 7%,transparent)}
#stsm .stsm-item:last-child{border-bottom:none}
#stsm .stsm-item-main{flex:1 1 auto;min-width:0}
#stsm .stsm-name{font-size:12.5px}
#stsm .stsm-meta{font-size:11px;opacity:.55;margin-left:6px}
#stsm .stsm-preview{font-size:11.5px;opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#stsm .stsm-acts{display:flex;gap:4px;flex:0 0 auto}
#stsm .stsm-acts button{font-size:11.5px;padding:2px 7px}
#stsm .stsm-use{margin-top:8px;font-size:11.5px;line-height:1.8;opacity:.65}
#stsm .stsm-ver{margin-left:auto;font-size:11px;opacity:.7;font-family:var(--monoFontFamily,ui-monospace,Menlo,monospace)}
/* 面板整体也设个上限，小屏/窄屏不会把设置页顶爆 */
#stsm .stsm-main{max-height:70vh;overflow-y:auto;overscroll-behavior:contain;padding-right:2px}
#stsm .stsm-main::-webkit-scrollbar{width:8px}
#stsm .stsm-main::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--SmartThemeBodyColor,#fff) 18%,transparent);border-radius:4px}
#stsm .stsm-use code{font-family:var(--monoFontFamily,ui-monospace,Menlo,monospace);
 background:color-mix(in srgb,var(--SmartThemeBodyColor,#fff) 9%,transparent);padding:1px 4px;border-radius:4px}
#stsm .stsm-empty{font-size:12px;opacity:.6;padding:8px 0;line-height:1.7}
#stsm .inline-drawer-content{display:none}
/* ---------- 编辑弹窗（设置页与悬浮窗共用同一个） ---------- */
#stse{position:fixed;inset:0;z-index:60010;display:none;align-items:center;justify-content:center;
 background:rgba(0,0,0,.42);font-size:13px;color:var(--SmartThemeBodyColor,#e8eaf0)}
#stse.stse-open{display:flex}
#stse .stse-card{width:540px;max-width:92vw;max-height:86vh;display:flex;flex-direction:column;gap:7px;
 padding:13px 15px 11px;border-radius:12px;
 border:1px solid color-mix(in srgb,var(--SmartThemeBodyColor,#fff) 18%,transparent);
 background:var(--SmartThemeBlurTintColor,rgba(27,28,32,.98));
 box-shadow:0 16px 48px rgba(0,0,0,.45)}
#stse .stse-title{display:flex;align-items:center;gap:8px;font-weight:600;font-size:13.5px}
#stse .stse-hint{margin-left:auto;font-size:11px;opacity:.55;font-weight:400}
#stse textarea{min-height:200px;max-height:52vh;resize:vertical;line-height:1.55;font-size:12.5px}
#stse .stse-row{display:flex;gap:6px;align-items:center}
#stse .stse-count{font-size:11.5px;opacity:.55;margin-left:auto}
#stse .stse-ok{background:color-mix(in srgb,var(--SmartThemeQuoteColor,#2f9e62) 26%,transparent);
 border-color:color-mix(in srgb,var(--SmartThemeQuoteColor,#2f9e62) 45%,transparent);font-weight:600}
/* ---------- 悬浮窗（魔棒菜单打开） ---------- */
#stsw{position:fixed;z-index:60000;display:none;flex-direction:column;width:288px;max-width:88vw;
 max-height:86vh;overflow:hidden;
 border-radius:12px;border:1px solid color-mix(in srgb,var(--SmartThemeBodyColor,#fff) 18%,transparent);
 background:var(--SmartThemeBlurTintColor,rgba(27,28,32,.96));color:var(--SmartThemeBodyColor,#e8eaf0);
 box-shadow:0 10px 30px rgba(0,0,0,.35);font-size:13px;backdrop-filter:blur(8px)}
#stsw.stsw-open{display:flex}
#stsw .stsw-head{display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:move;
 user-select:none;-webkit-user-select:none;touch-action:none;
 border-bottom:1px solid color-mix(in srgb,var(--SmartThemeBodyColor,#fff) 10%,transparent)}
#stsw .stsw-title{font-weight:600;font-size:13px}
#stsw .stsw-sum{margin-left:auto;font-size:11px;opacity:.6;white-space:nowrap}
#stsw .stsw-x{cursor:pointer;opacity:.55;padding:0 3px;font-size:13px}
#stsw .stsw-x:hover{opacity:1}
#stsw .stsw-chips{display:flex;flex-wrap:wrap;gap:5px;padding:8px 10px;max-height:168px;min-height:0;overflow-y:auto;overscroll-behavior:contain}
#stsw .stsw-chips::-webkit-scrollbar{width:8px}
#stsw .stsw-chips::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--SmartThemeBodyColor,#fff) 18%,transparent);border-radius:4px}
#stsw .stsw-chips::-webkit-scrollbar-track{background:transparent}
#stsw .stsw-foot{display:flex;gap:6px;align-items:center;padding:6px 10px 9px;
 border-top:1px solid color-mix(in srgb,var(--SmartThemeBodyColor,#fff) 10%,transparent)}
#stsw button{background:color-mix(in srgb,var(--SmartThemeBodyColor,#fff) 10%,transparent);
 border:1px solid color-mix(in srgb,var(--SmartThemeBodyColor,#fff) 18%,transparent);color:inherit;
 border-radius:6px;padding:3px 9px;font-size:12px;cursor:pointer;white-space:nowrap}
#stsw button:hover{background:color-mix(in srgb,var(--SmartThemeBodyColor,#fff) 18%,transparent)}
#stsw .stsw-empty{font-size:12px;opacity:.6;padding:4px 0;line-height:1.6}
`;

function esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildUI() {
	const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
	if (!host) {
		console.warn(TAG, '未找到扩展设置容器，跳过挂载');
		return;
	}
	if (document.getElementById('stsm')) { return; }

	const style = document.createElement('style');
	style.id = 'stsm-style';
	style.textContent = CSS;
	document.head.appendChild(style);

	panel = document.createElement('div');
	panel.id = 'stsm';
	panel.className = 'inline-drawer';
	panel.innerHTML = `
<div class="inline-drawer-toggle inline-drawer-header">
	<div class="stsm-head"><b>文风管理器</b><span class="stsm-summary"></span></div>
	<div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
</div>
<div class="inline-drawer-content">
	<div class="stsm-main">
		<div class="stsm-chips"></div>
		<div class="stsm-bar">
			<button class="stsm-add">新建文风</button>
			<button class="stsm-imp">导入</button>
			<button class="stsm-exp">导出</button>
			<span class="stsm-count"></span>
		</div>
		<div class="stsm-bar">
			<input class="stsm-search" placeholder="搜索名称 / 标签 / 正文…">
		</div>
		<div class="stsm-list"></div>
		<div class="stsm-use">
			在预设或系统提示里写 <code>{{style}}</code>，就会插入所有点亮文风的组合正文；再点一下标签即可取消。
			<div class="stsm-bar" style="margin-top:6px">
				<button class="stsm-copy-tag">复制 {{style}}</button>
				<button class="stsm-copy-body">复制组合结果</button>
				<span class="stsm-ver" title="当前插件版本（可用来核对更新是否生效）">${VERSION}</span>
			</div>
		</div>
	</div>
</div>`;
	host.prepend(panel);

	panel.querySelector('.stsm-add').addEventListener('click', () => openEditor(null));
	panel.querySelector('.stsm-imp').addEventListener('click', doImport);
	panel.querySelector('.stsm-exp').addEventListener('click', doExport);
	panel.querySelector('.stsm-search').addEventListener('input', (e) => {
		query = e.target.value.trim().toLowerCase();
		renderList();
	});
	panel.querySelector('.stsm-copy-tag').addEventListener('click', () => copyText('{{style}}'));
	panel.querySelector('.stsm-copy-body').addEventListener('click', () => {
		const body = composeStyle();
		if (!body) {
			window.toastr?.info('还没有点亮任何文风');
			return;
		}
		copyText(body);
	});

	// 标签点击：点亮 / 取消（可多选，顺序 = 点亮顺序）
	panel.querySelector('.stsm-chips').addEventListener('click', (e) => {
		const chip = e.target.closest('.stsm-chip');
		if (!chip) { return; }
		toggleSelected(chip.dataset.id);
	});

	// 列表动作
	panel.querySelector('.stsm-list').addEventListener('click', (e) => {
		const btn = e.target.closest('button[data-act]');
		if (!btn) { return; }
		const item = btn.closest('.stsm-item');
		if (item && item.dataset.id) { handleAction(btn.dataset.act, item.dataset.id); }
	});

	renderAll();
}

function toggleSelected(id) {
	const s = store();
	const i = s.selectedIds.indexOf(id);
	if (i >= 0) {
		s.selectedIds.splice(i, 1);
	} else {
		s.selectedIds.push(id);
	}
	persist();
	renderAll();
}

function renderAll() {
	renderChips();
	renderList();
	renderSummary();
}

function renderChips() {
	const s = store();
	const html = s.styles.length === 0 ? '' : s.styles.map((x) => {
		const lit = s.selectedIds.includes(x.id);
		const tip = esc((x.content || '').replace(/\s+/g, ' ').slice(0, 120));
		return `<span class="stsm-chip${lit ? ' stsm-lit' : ''}" data-id="${esc(x.id)}" title="${tip}">${esc(x.name)}</span>`;
	}).join('');

	// 设置页
	const box = panel.querySelector('.stsm-chips');
	if (box) { box.innerHTML = html; }

	// 悬浮窗（和设置页是同一份数据，点哪边都同步）
	if (floatWin) {
		const fbox = floatWin.querySelector('.stsw-chips');
		if (fbox) {
			fbox.innerHTML = html || '<div class="stsw-empty">盒子里还没有文风，点下面的「+ 新建」加一条。</div>';
		}
	}
}

function renderSummary() {
	const picked = selectedStyles();
	const text = picked.length === 0 ? '未点亮' : `已点亮 ${picked.length} · ${composeStyle().length} 字`;
	const el = panel.querySelector('.stsm-summary');
	if (el) { el.textContent = text; }
	if (floatWin) {
		const f = floatWin.querySelector('.stsw-sum');
		if (f) { f.textContent = text; }
	}
}

function renderList() {
	const box = panel.querySelector('.stsm-list');
	const styles = store().styles;
	let list = styles;
	if (query) {
		list = styles.filter((x) => `${x.name} ${x.tags || ''} ${x.content}`.toLowerCase().includes(query));
	}

	const count = panel.querySelector('.stsm-count');
	count.textContent = `${styles.length} 条 · 共 ${styles.reduce((n, x) => n + (x.content || '').length, 0)} 字`;

	if (list.length === 0) {
		box.innerHTML = styles.length === 0
			? `<div class="stsm-empty">盒子还是空的。<button class="stsm-sample">添加一条示例文风</button></div>`
			: `<div class="stsm-empty">没有匹配「${esc(query)}」的文风。</div>`;
		const sampleBtn = box.querySelector('.stsm-sample');
		if (sampleBtn) { sampleBtn.addEventListener('click', addSample); }
		return;
	}

	box.innerHTML = list.map((x) => {
		const len = (x.content || '').length;
		const tags = (x.tags || '').trim();
		const preview = (x.content || '').replace(/\s+/g, ' ').slice(0, 90);
		const lit = store().selectedIds.includes(x.id);
		return `
<div class="stsm-item" data-id="${esc(x.id)}">
	<div class="stsm-item-main">
		<div><span class="stsm-name">${lit ? '✓ ' : ''}${esc(x.name)}</span><span class="stsm-meta">${len} 字${tags ? ' · ' + esc(tags) : ''}</span></div>
		<div class="stsm-preview">${esc(preview)}</div>
	</div>
	<div class="stsm-acts">
		<button data-act="edit">编辑</button>
		<button data-act="dup">复制</button>
		<button data-act="del">删除</button>
	</div>
</div>`;
	}).join('');
}

function handleAction(act, id) {
	const s = store();
	const idx = s.styles.findIndex((x) => x.id === id);
	if (idx < 0) { return; }
	const item = s.styles[idx];

	if (act === 'edit') { openEditor(item); return; }

	if (act === 'dup') {
		const copy = { ...item, id: uid(), name: `${item.name} 副本`, createdAt: Date.now(), updatedAt: Date.now() };
		s.styles.splice(idx + 1, 0, copy);
		persist();
		renderAll();
		return;
	}

	if (act === 'del') {
		if (!window.confirm(`删除文风「${item.name}」？此操作不可撤销。`)) { return; }
		s.styles.splice(idx, 1);
		s.selectedIds = s.selectedIds.filter((x) => x !== id);
		persist();
		renderAll();
	}
}

// ---------------- 编辑器（独立弹窗：设置页与悬浮窗共用） ----------------

let editorBox = null;

function ensureEditorModal() {
	if (editorBox && document.getElementById('stse')) { return editorBox; }
	editorBox = document.createElement('div');
	editorBox.id = 'stse';
	editorBox.innerHTML = `
<div class="stse-card">
	<div class="stse-title"><span class="stse-heading">新建文风</span><span class="stse-hint">别人的文风整段复制进来即可</span></div>
	<input class="stse-name" placeholder="文风名称，例如：冷峻克制">
	<input class="stse-tags" placeholder="标签，逗号分隔（可选）">
	<textarea class="stse-content" placeholder="粘贴文风正文：语气、句式、用词偏好、节奏、禁忌、示例句式…"></textarea>
	<div class="stse-row">
		<button class="stse-paste" title="从剪贴板读取文本填入正文">从剪贴板粘贴</button>
		<span class="stse-count">0 字</span>
		<button class="stse-cancel">取消</button>
		<button class="stse-ok">保存</button>
	</div>
</div>`;
	document.body.appendChild(editorBox);

	const q = (sel) => editorBox.querySelector(sel);
	q('.stse-ok').addEventListener('click', saveEditor);
	q('.stse-cancel').addEventListener('click', closeEditor);
	q('.stse-content').addEventListener('input', updateEditorCount);

	// 点遮罩不关闭：避免误触丢掉刚粘贴的长文
	editorBox.addEventListener('mousedown', (e) => {
		if (e.target === editorBox) { e.preventDefault(); }
	});

	// Esc 关闭；名称框回车直接保存（正文框的回车要留给换行）
	editorBox.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') {
			e.stopPropagation();
			closeEditor();
		}
		if (e.key === 'Enter' && e.target.classList.contains('stse-name') && !e.isComposing) {
			e.preventDefault();
			saveEditor();
		}
	});

	q('.stse-paste').addEventListener('click', async () => {
		try {
			if (!navigator.clipboard?.readText) { throw new Error('浏览器不支持读取剪贴板'); }
			const text = await navigator.clipboard.readText();
			if (!text || !text.trim()) {
				window.toastr?.info('剪贴板里没有文本');
				return;
			}
			const box = q('.stse-content');
			box.value = box.value.trim() ? `${box.value}\n${text}` : text;
			updateEditorCount();
			box.focus();
			window.toastr?.success(`已粘贴 ${text.length} 字`);
		} catch (err) {
			window.toastr?.warning('读不到剪贴板，请手动 Ctrl/Cmd+V 粘贴');
			q('.stse-content').focus();
			console.warn(TAG, '剪贴板读取失败', err);
		}
	});

	return editorBox;
}

function openEditor(item) {
	const box = ensureEditorModal();
	editingId = item ? item.id : null;
	box.querySelector('.stse-heading').textContent = item ? '编辑文风' : '新建文风';
	box.querySelector('.stse-name').value = item ? item.name : '';
	box.querySelector('.stse-tags').value = item ? (item.tags || '') : '';
	box.querySelector('.stse-content').value = item ? item.content : '';
	updateEditorCount();
	box.classList.add('stse-open');
	// 延后聚焦，等弹窗布局完成
	setTimeout(() => box.querySelector('.stse-name').focus(), 30);
}

function closeEditor() {
	if (editorBox) { editorBox.classList.remove('stse-open'); }
	editingId = null;
}

function updateEditorCount() {
	if (!editorBox) { return; }
	const n = editorBox.querySelector('.stse-content').value.length;
	editorBox.querySelector('.stse-count').textContent = `${n} 字`;
}

function saveEditor() {
	const box = editorBox;
	if (!box) { return; }
	const name = box.querySelector('.stse-name').value.trim();
	const content = box.querySelector('.stse-content').value;
	const tags = box.querySelector('.stse-tags').value.trim();

	if (!name) {
		window.toastr?.warning('请填写文风名称');
		box.querySelector('.stse-name').focus();
		return;
	}
	if (!content.trim()) {
		window.toastr?.warning('文风正文为空');
		box.querySelector('.stse-content').focus();
		return;
	}

	const s = store();
	if (editingId) {
		const item = s.styles.find((x) => x.id === editingId);
		if (item) {
			item.name = name;
			item.content = content;
			item.tags = tags;
			item.updatedAt = Date.now();
		}
	} else {
		const item = { id: uid(), name, content, tags, createdAt: Date.now(), updatedAt: Date.now() };
		s.styles.push(item);
		// 新建后自动点亮，省一次点击
		if (!s.selectedIds.includes(item.id)) { s.selectedIds.push(item.id); }
	}
	persist();
	closeEditor();
	renderAll();
}

function addSample() {
	const s = store();
	const item = {
		id: uid(),
		name: '示例 · 冷峻克制',
		tags: '示例',
		content: [
			'叙事保持第三人称限知，语气冷峻克制，避免抒情与感叹。',
			'句子偏短，多用陈述句；动词优先，形容词节制。',
			'环境描写只写可观察到的细节（光、声音、温度、材质），不写心理独白。',
			'对话简短，允许答非所问；情绪通过动作与停顿透露。',
		].join('\n'),
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
	s.styles.push(item);
	s.selectedIds.push(item.id);
	persist();
	renderAll();
}

// ---------------- 导入导出 ----------------

function doExport() {
	const s = store();
	if (s.styles.length === 0) {
		window.toastr?.info('盒子里没有文风可导出');
		return;
	}
	const data = {
		type: 'sillytavern-style-manager',
		version: 2,
		exportedAt: new Date().toISOString(),
		selectedIds: s.selectedIds,
		styles: s.styles,
	};
	const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = `文风盒子-${new Date().toISOString().slice(0, 10)}.json`;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

function doImport() {
	const input = document.createElement('input');
	input.type = 'file';
	input.accept = '.json,application/json';
	input.addEventListener('change', async () => {
		const file = input.files && input.files[0];
		if (!file) { return; }
		try {
			const data = JSON.parse(await file.text());
			const incoming = Array.isArray(data) ? data : (Array.isArray(data.styles) ? data.styles : []);
			if (incoming.length === 0) {
				window.toastr?.warning('文件里没有找到文风数据');
				return;
			}
			const s = store();
			let added = 0;
			for (const raw of incoming) {
				const name = String(raw.name || '').trim();
				const content = String(raw.content || '');
				if (!name || !content.trim()) { continue; }
				s.styles.push({
					id: uid(),
					name: s.styles.some((x) => x.name === name) ? `${name}（导入）` : name,
					content,
					tags: String(raw.tags || ''),
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				added++;
			}
			persist();
			renderAll();
			window.toastr?.success(`已导入 ${added} 条文风`);
		} catch (err) {
			console.error(TAG, '导入失败', err);
			window.toastr?.error('导入失败：不是合法的 JSON 文件');
		}
	});
	input.click();
}

// ---------------- 工具 ----------------

function copyText(text) {
	const done = () => window.toastr?.success(`已复制（${text.length} 字）`);
	if (navigator.clipboard && window.isSecureContext) {
		navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
	} else {
		fallbackCopy(text, done);
	}
}

function fallbackCopy(text, done) {
	const ta = document.createElement('textarea');
	ta.value = text;
	ta.style.position = 'fixed';
	ta.style.opacity = '0';
	document.body.appendChild(ta);
	ta.select();
	try { document.execCommand('copy'); done(); } catch { /* 忽略 */ }
	ta.remove();
}

// ---------------- 悬浮窗（魔棒菜单打开） ----------------

function buildFloat() {
	if (document.getElementById('stsw')) {
		floatWin = document.getElementById('stsw');
		return;
	}
	floatWin = document.createElement('div');
	floatWin.id = 'stsw';
	floatWin.innerHTML = `
<div class="stsw-head">
	<span class="stsw-title">文风管理器</span>
	<span class="stsw-sum">未点亮</span>
	<span class="stsw-x" title="关闭">✕</span>
</div>
<div class="stsw-chips"></div>
<div class="stsw-foot">
	<button class="stsw-new" title="新建一条文风（把别人的文风整段粘进来）">+ 新建</button>
	<button class="stsw-copy">复制 {{style}}</button>
</div>`;
	document.body.appendChild(floatWin);

	floatWin.querySelector('.stsw-x').addEventListener('click', () => toggleFloat(false));
	floatWin.querySelector('.stsw-copy').addEventListener('click', () => copyText('{{style}}'));
	floatWin.querySelector('.stsw-new').addEventListener('click', () => openEditor(null));

	// 点标签切换：与设置页共用同一份数据，两边自动同步
	floatWin.querySelector('.stsw-chips').addEventListener('click', (e) => {
		const chip = e.target.closest('.stsm-chip');
		if (chip) { toggleSelected(chip.dataset.id); }
	});

	// 拖动 + 记忆位置
	let drag = null;
	const head = floatWin.querySelector('.stsw-head');
	head.addEventListener('pointerdown', (e) => {
		if (e.target.closest('.stsw-x')) { return; }
		const r = floatWin.getBoundingClientRect();
		drag = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top };
		head.setPointerCapture(e.pointerId);
	});
	head.addEventListener('pointermove', (e) => {
		if (!drag) { return; }
		floatWin.style.left = `${drag.ox + (e.clientX - drag.sx)}px`;
		floatWin.style.top = `${drag.oy + (e.clientY - drag.sy)}px`;
		floatWin.style.right = 'auto';
		floatWin.style.bottom = 'auto';
	});
	head.addEventListener('pointerup', () => {
		if (!drag) { return; }
		drag = null;
		const p = clampFloatIntoView();
		if (p) {
			const s = store();
			s.floatPos = p;
			persist();
		}
	});

	applyFloatPos();

	// 窗口尺寸变化（换设备、缩窗口、手机转屏）→ 立刻把浮窗拉回可视区并写回
	// 少了这一步就会重演「浮窗跑到屏幕外、再也看不见」的老毛病
	let resizeTimer = null;
	window.addEventListener('resize', () => {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => {
			const p = clampFloatIntoView();
			if (!p) { return; }
			const s = store();
			if (!s.floatPos || s.floatPos.x !== p.x || s.floatPos.y !== p.y) {
				s.floatPos = p;
				persist();
			}
		}, 200);
	});
}

// 浮窗尺寸兜底：元素隐藏时 getBoundingClientRect 全为 0，用它估边界
const FLOAT_FALLBACK_W = 288;
const FLOAT_FALLBACK_H = 240;

function clampFloatIntoView() {
	if (!floatWin) { return null; }
	const shown = floatWin.classList.contains('stsw-open');
	const r = floatWin.getBoundingClientRect();
	const w = (shown && r.width) ? r.width : FLOAT_FALLBACK_W;
	const h = (shown && r.height) ? r.height : FLOAT_FALLBACK_H;
	const maxX = Math.max(4, window.innerWidth - w - 4);

	// 高度会随内容/字体加载变化（实测同一帧能差 50px），所以不拿它当准绳，
	// 而是给一个「至少留 160px 可见」的保守余量，再用 max-height 兜底。
	const reserveH = Math.min(Math.max(h, 160), Math.max(160, window.innerHeight - 8));
	const maxY = Math.max(4, window.innerHeight - reserveH - 4);

	const x0 = parseFloat(floatWin.style.left);
	const y0 = parseFloat(floatWin.style.top);
	// 还没用绝对定位（默认靠 left/bottom）→ 无需钳制
	if (!Number.isFinite(x0) || !Number.isFinite(y0)) { return null; }

	const x = Math.min(Math.max(4, x0), maxX);
	const y = Math.min(Math.max(4, y0), maxY);
	floatWin.style.left = `${x}px`;
	floatWin.style.top = `${y}px`;
	floatWin.style.right = 'auto';
	floatWin.style.bottom = 'auto';
	// 关键兜底：不管内容以后长多高，都不会溢出视口底部（chips 区自己滚）
	floatWin.style.maxHeight = `${Math.max(120, window.innerHeight - y - 8)}px`;
	return { x, y };
}

function applyFloatPos() {
	if (!floatWin) { return; }
	const s = store();
	floatWin.style.right = 'auto';
	floatWin.style.bottom = 'auto';
	if (s.floatPos && Number.isFinite(s.floatPos.x) && Number.isFinite(s.floatPos.y)) {
		floatWin.style.left = `${s.floatPos.x}px`;
		floatWin.style.top = `${s.floatPos.y}px`;
		const p = clampFloatIntoView();
		// 存的位置在当前屏幕放不下（换设备/改分辨率）→ 把修正值写回，下次直接用对的
		if (p && (p.x !== s.floatPos.x || p.y !== s.floatPos.y)) {
			s.floatPos = p;
			persist();
		}
	} else {
		// 默认位置（左下角靠 bottom 定位）：清掉钳制时设的行内 max-height，回到 CSS 的 86vh
		floatWin.style.maxHeight = '';
		floatWin.style.left = '16px';
		floatWin.style.bottom = '96px';
	}
}

function toggleFloat(force) {
	if (!floatWin) { buildFloat(); }
	const open = typeof force === 'boolean' ? force : !floatWin.classList.contains('stsw-open');
	if (open) {
		floatWin.classList.add('stsw-open');
		applyFloatPos();
		renderAll();
	} else {
		floatWin.classList.remove('stsw-open');
	}
}

/** 往魔棒菜单（左下角）加一条「文风管理器」 */
function injectWandMenu() {
	let attempts = 0;
	const tryInject = () => {
		const menu = document.getElementById('extensionsMenu');
		if (!menu) {
			if (++attempts <= 40) { setTimeout(tryInject, 500); }
			return;
		}
		if (document.getElementById('stsw-menu-item')) { return; }

		const container = document.createElement('div');
		container.id = 'stsw-menu-container';
		container.className = 'extension_container';

		const button = document.createElement('div');
		button.id = 'stsw-menu-item';
		button.className = 'list-group-item flex-container flexGap5';
		button.tabIndex = 0;
		button.setAttribute('role', 'button');

		const icon = document.createElement('div');
		icon.className = 'fa-solid fa-pen-nib extensionsMenuExtensionButton';

		const label = document.createElement('span');
		label.textContent = '文风管理器';

		button.append(icon, label);
		container.appendChild(button);
		menu.appendChild(container);

		const toggle = () => toggleFloat();
		button.addEventListener('click', toggle);
		button.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				toggle();
			}
		});
	};
	tryInject();
}

// ---------------- 启动 ----------------

registerMacros();
ensureSeeded();
console.log(TAG, `${VERSION} 已加载；宏：{{style}}（多选标签组合）`);

function selfCheck() {
	try {
		const ok = [];
		try { if (macros.registry.getMacro('style')) { ok.push('style'); } } catch { /* 忽略 */ }
		document.documentElement.dataset.stsmMacros = ok.join(',');

		if (new URLSearchParams(location.search).has('stsmdebug')) {
			const backup = JSON.parse(JSON.stringify(extension_settings.styleManager ?? null));
			const s = store();
			s.styles = [
				{ id: '__a', name: '甲', content: 'AAA', tags: '', createdAt: 0, updatedAt: 0 },
				{ id: '__b', name: '乙', content: 'BBB', tags: '', createdAt: 0, updatedAt: 0 },
			];
			s.selectedIds = ['__b', '__a'];
			const out = substituteParams('{{style}}');
			if (backup === null) { delete extension_settings.styleManager; } else { extension_settings.styleManager = backup; }
			document.documentElement.dataset.stsmTest = JSON.stringify(out);

			// 编辑器自检：确认独立弹窗能打开、字段齐全（不写盘）
			try {
				openEditor(null);
				const box = document.getElementById('stse');
				const ok = !!box && box.classList.contains('stse-open')
					&& !!box.querySelector('.stse-name')
					&& !!box.querySelector('.stse-content')
					&& !!box.querySelector('.stse-paste');
				document.documentElement.dataset.stsmEditor = ok ? 'ok' : 'fail';
				closeEditor();
			} catch (err) {
				document.documentElement.dataset.stsmEditor = `err:${err.message}`;
			}

			// 边界钳制自检：只做纯计算，绝不碰真实浮窗、不写盘
			// （早期版本在这里直接操作 DOM，会触发 resize 链把测试坐标写进用户设置，已废弃）
			try {
				const vw = window.innerWidth;
				const vh = window.innerHeight;
				const fw = FLOAT_FALLBACK_W;
				const fh = 160; // 至少保留的可视高度
				const maxX = Math.max(4, vw - fw - 4);
				const maxY = Math.max(4, vh - Math.min(Math.max(FLOAT_FALLBACK_H, 160), Math.max(160, vh - 8)) - 4);
				const cx = Math.min(Math.max(4, 99999), maxX);
				const cy = Math.min(Math.max(4, 99999), maxY);
				const fits = cx >= 4 && cy >= 4 && cx + fw <= vw && cy + fh <= vh;
				document.documentElement.dataset.stsmClamp = fits
					? `ok:${cx},${cy}`
					: `fail:${cx},${cy},${cx + fw},${cy + fh}`;
			} catch (err) {
				document.documentElement.dataset.stsmClamp = `err:${err.message}`;
			}
		}
	} catch (err) {
		document.documentElement.dataset.stsmMacros = 'error';
		console.warn(TAG, '自检失败', err);
	}
}

jQuery(() => {
	buildUI();
	buildFloat();
	renderAll();
	injectWandMenu();
	selfCheck();
});
