// ==UserScript==
// @name         ChatGPT模型选择器增强
// @namespace    http://tampermonkey.net/
// @author       schweigen
// @version      2.3.1
// @description  增强 Main 模型选择器（黏性重排、防抖动、自定义项、丝滑切换、隐藏分组与Legacy）；并集成“使用其他模型重试的模型选择器”快捷项与30秒强制模型窗口（自动触发原生项或重试）；可以自定义模型顺序。特别鸣谢:attention1111(linux.do)，gpt-5；已适配 ChatGPT Atlas
// @match        *://*.chatgpt.com/*
// @match        https://chatgpt.com/?model=*
// @match        https://chatgpt.com/?temporary-chat=*
// @match        https://chatgpt.com/c/*
// @match        https://chatgpt.com/g/*
// @match        https://chatgpt.com/share/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/lueluelue2006/ChatGPT-Model-Switcher/main/ChatGPT_Model_Switcher.js
// @updateURL    https://raw.githubusercontent.com/lueluelue2006/ChatGPT-Model-Switcher/main/ChatGPT_Model_Switcher.js
// ==/UserScript==

(() => {
  'use strict';
  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  // 日志工具
  const FM = (() => {
    const prefix = '[fm]';
    const safe = (fn, ...a) => { try { fn(prefix, ...a); } catch {} };
    return {
      log:  (...a) => safe(console.log,  ...a),
      info: (...a) => safe(console.info, ...a),
      warn: (...a) => safe(console.warn, ...a),
      error:(...a) => safe(console.error,...a),
    };
  })();

  // schweigen said: 老虎机版vibe coding，我都不知道我在写什么，纯屎山，勿喷 :D
  // 特别鸣谢:attention1111(linux.do)，gpt-5
  // 现状说明：
  // 1) 临时聊天（temporary-chat）暂时无法增强“使用其他模型重试的模型选择器”。
  // 2) Projects 中目前官方没有“重试”按钮，笔者太菜不知道怎么添加能抗住遥测的retry按钮。
  // ========= 概览：本脚本处理“两个不同的菜单”并采用不同匹配/放置策略 =========
  // 1) Main 模型选择器（Main Model Switcher）
  //    - 匹配条件：
  //      role="menu" | "listbox"，且包含 Main 菜单签名 [data-testid^="model-switcher-"] 或 [data-cgpt-turn]；
  //      同时不包含“重试模型选择器”关键字（Auto/Instant/Thinking/Pro/Ultra）。
  //    - 放置策略：
  //      若无同名原生项，则在“最后一个 GPT‑5 原生项”之后插入自定义项，随后用 applyDesiredOrder 按订阅层级的目标顺序黏性重排。
  //      并隐藏“Legacy models”相关入口/分隔线，尽量减少 hover 抖动和菜单关闭。
  //    - 点击行为：
  //      自定义项阻止冒泡后，先做“丝滑更新”（URL+按钮文案），再尝试点击同 id 的原生项，让后端状态切换。
  //
  // 2) 使用其他模型重试的模型选择器（Auto/Instant/Thinking(mini)/Pro/Ultra(Think)）
  //    - 匹配条件：
  //      菜单内出现上述关键字，且不含 Main 菜单签名（与 Main 模型选择器互斥）。
  //    - 放置策略：
  //      以锚点项为参照（优先 o4 mini / gpt‑4o / gpt‑4.1，找不到则取第一项），在其后插入 4 个快捷项：
  //      o3 pro、GPT 5 mini、o4 mini high、GPT 4.5（按订阅层级可能被隐藏）。
  //    - 点击行为：
  //      点击快捷项会 setForce(model, 2000) 开启 2 秒的强制模型窗口，随后优先触发原生菜单项；
  //      若没有，则回退点击“重试/Regenerate”。期间 fetch 改写会把会话请求中的 model 重写为强制模型。
  //
  // 触发与监听：
  // - 入口按钮：[data-testid="model-switcher-dropdown-button"]。首次点击时，对其关联菜单安装观察器；
  //   全局还注册一个 MutationObserver 作为兜底：发现任意新菜单后按类型路由到对应处理逻辑。
  // - 其它：通过 Analytics 的“Model Switcher”事件同步顶部按钮文案；URL 的 ?model= 同步到按钮；样式上隐藏 legacy 分隔线。

  // ---------------- 配置 ----------------
  const TEST_ID_SWITCHER = 'model-switcher-dropdown-button';
  // 订阅层级存储键与默认值
  const SUB_KEY = 'chatgpt-subscription-tier';
  const SUB_DEFAULT = 'plus';
  const SUB_LEVELS = ['free','go','plus','team','edu','enterprise','pro'];

  function gmGet(key, defVal = undefined) {
    try { if (typeof GM_getValue === 'function') return GM_getValue(key, defVal); } catch {}
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? defVal : JSON.parse(raw);
    } catch { return defVal; }
  }
  function gmSet(key, val) {
    try { if (typeof GM_setValue === 'function') return GM_setValue(key, val); } catch {}
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }
  function getTier() {
    const saved = (gmGet(SUB_KEY, '') || '').toString().trim().toLowerCase();
    return SUB_LEVELS.includes(saved) ? saved : '';
  }
  function setTier(tier) {
    const norm = (tier || '').toString().trim().toLowerCase();
    if (!SUB_LEVELS.includes(norm)) return;
    gmSet(SUB_KEY, norm);
  }
  function tierPromptText() {
    return '请选择订阅层级（仅出现一次，之后可在油猴菜单重新选择；不区分大小写）：\n' +
      'free / go / plus / team / edu / enterprise / pro\n\n' +
      '提示：若选错，可在油猴脚本菜单点击“重新选择订阅层级”。';
  }
  function chooseTierInteractively(defaultTier = SUB_DEFAULT, silent = false) {
    while (true) {
      const inputRaw = window.prompt(tierPromptText(), defaultTier);
      if (inputRaw == null) {
        const chosen = (defaultTier || SUB_DEFAULT).toLowerCase();
        setTier(chosen);
        if (!silent) { try { location.reload(); } catch {} }
        return chosen;
      }
      const input = String(inputRaw).trim().toLowerCase();
      if (!SUB_LEVELS.includes(input)) {
        try { alert('订阅层级无效，请重新输入'); } catch {}
        continue;
      }
      setTier(input);
      if (!silent) {
        try {
          let msg = '已设置订阅层级：' + input;
          switch (input) {
            case 'edu':
              msg += '\n\n重要：edu 套餐的拓展模型如果无法在主页面使用，请前往 Projects 中使用。**且**用户必须在设置里开启“启用更多模型/老模型”。';
              break;
            case 'plus':
              msg += '\n\n重要：必须在设置里开启“启用更多模型/老模型”，才能使用老模型';
              break;
            case 'team':
              msg += '\n\n重要：必须让 team**所有者/管理者** 在设置中开启“启用更多模型/老模型”，**且**用户必须在设置里开启“启用更多模型/老模型”，才能使用老模型';
              break;
            case 'enterprise':
              msg += '\n\n重要：必须让企业**所有者/管理者** 在设置中开启“启用更多模型/老模型”，**且**用户必须在设置里开启“启用更多模型/老模型”，才能使用老模型。拓展模型如果无法在主页面使用，请前往 Projects 中使用。';
              break;
            case 'pro':
              msg += '\n\n重要：如果无法使用老模型，可以看下设置里有没有开启“启用更多模型/老模型”';
              break;
          }
          alert(msg);
        } catch {}
      }
      if (!silent) { try { location.reload(); } catch {} }
      return input;
    }
  }
  function ensureTierChosen() {
    const t = getTier();
    if (!t) return chooseTierInteractively(SUB_DEFAULT, false);
    return t;
  }

  // 注册“重新选择订阅层级”菜单
  try {
    if (typeof GM_registerMenuCommand === 'function') {
      const currentTierForMenu = getTier() || '未设置';
      GM_registerMenuCommand(`重新选择订阅层级（现在：${currentTierForMenu}）`, () => chooseTierInteractively());
    }
  } catch {}

  // 默认目标顺序（按 data-testid 后缀）
  const BASE_ORDER = [
    'gpt-5-thinking',
    'gpt-5-t-mini',
    'gpt-5-instant',
    'gpt-5',
    'gpt-5-mini',
    'o3',
    'o4-mini-high',
    'o4-mini',
    'gpt-4o',
    'gpt-4-1',
    'o3-pro',
    'gpt-5-pro',
    'gpt-4-5',
    'chatgpt_alpha_model_external_access_reserved_gate_13',
  ];
  const PRO_PRIORITY_ORDER = [
    'gpt-5-thinking',
    'gpt-4-5',
    'o3',
    'o4-mini-high',
    'gpt-5-pro',
    'o3-pro',
  ];
  function getDesiredOrder() {
    const tier = getTier() || SUB_DEFAULT;
    if (tier === 'pro') {
      const seen = new Set();
      const pushUnique = (arr, target) => {
        for (const id of arr) {
          if (seen.has(id)) continue;
          seen.add(id);
          target.push(id);
        }
      };
      const result = [];
      pushUnique(PRO_PRIORITY_ORDER, result);
      pushUnique(BASE_ORDER, result);
      return result;
    }
    return BASE_ORDER;
  }
  const ALT_IDS = { 'gpt-4-1': ['gpt-4.1'], 'gpt-4-5': ['gpt-4.5'] };

  // 点击后不自动收起菜单的模型（硬编码名单）
  const NO_CLOSE_ON_CHOOSE_IDS = new Set([
    'gpt-5',
    'gpt-5-instant',
    'gpt-5-thinking',
    'gpt-5-pro',
    'gpt-5-t-mini',
  ]);

  // 自定义模型项（若该菜单已经有官方同名项则不重复插入）
  const CUSTOM_MODELS = [
    { id: 'o3',           label: 'o3' },
    { id: 'o3-pro',       label: 'o3 pro' },
    { id: 'gpt-4-1',      label: 'GPT 4.1' },
    { id: 'gpt-4o',       label: 'GPT 4o' },
    { id: 'o4-mini',      label: 'o4 mini' },
    { id: 'o4-mini-high', label: 'o4 mini high' },
    { id: 'gpt-5',        label: 'GPT 5 Auto' },
    { id: 'gpt-5-instant',label: 'GPT 5 Instant' },
    { id: 'gpt-5-t-mini', label: 'GPT 5 Thinking Mini' },
    { id: 'gpt-5-mini',   label: 'GPT 5 mini' },
    { id: 'gpt-5-thinking', label: 'GPT 5 Thinking' },
    { id: 'gpt-5-pro',    label: 'GPT 5 Pro' },
    { id: 'gpt-4-5',      label: 'GPT 4.5' },
    { id: 'chatgpt_alpha_model_external_access_reserved_gate_13', label: 'α' },
  ];

  // 层级可用性规则
  function isModelAllowed(id) {
    const norm = normalizeModelId(id);
    const tier = getTier() || SUB_DEFAULT;
    if (tier === 'free' || tier === 'go') {
      return norm === 'gpt-5-t-mini' || norm === 'gpt-5' || norm === 'gpt-5-mini';
    }
    if (tier === 'plus') {
      if (norm === 'o3-pro' || norm === 'gpt-5-pro' || norm === 'gpt-4-5') return false;
      return true;
    }
    // team 目前无 GPT 4.5
    if (tier === 'team') {
      if (norm === 'gpt-4-5') return false;
      return true;
    }
    // edu / enterprise / pro 全量可用
    return true;
  }

  // ---------------- 工具 ----------------
  const debounce = (fn, wait = 50) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn.apply(null, a), wait); }; };

  // 标准化与美化名称
  const CUSTOM_NAME_MAP = new Map(CUSTOM_MODELS.map(m => [m.id.toLowerCase(), m.label]));
  const EXTRA_NAME_MAP = new Map(Object.entries({
    'gpt-4o': 'GPT 4o',
    'gpt-4-1': 'GPT 4.1',
    'gpt-4.1': 'GPT 4.1',
    'gpt-4-5': 'GPT 4.5',
    'o3': 'o3',
    'o3-pro': 'o3 pro',
    'o4-mini': 'o4 mini',
    'o4-mini-high': 'o4 mini high',
    'gpt-5': 'GPT 5 Auto',
    'gpt-5-instant': 'GPT 5 Instant',
    'gpt-5-t-mini': 'GPT 5 Thinking Mini',
    'gpt-5-thinking': 'GPT 5 Thinking',
    'gpt-5-pro': 'GPT 5 Pro',
    'gpt-5-mini': 'GPT 5 mini',
  }));

  function normalizeModelId(id) {
    if (!id) return '';
    return String(id).trim().toLowerCase().replace(/\s+/g, '-').replace(/\./g, '-');
  }

  function prettyName(id) {
    const norm = normalizeModelId(id);
    return CUSTOM_NAME_MAP.get(norm) || EXTRA_NAME_MAP.get(norm) || id || '';
  }

  function setAllSwitcherButtonsModel(modelId) {
    if (!modelId) return;
    const norm = normalizeModelId(modelId);
    const name = prettyName(norm);
    FM.info('update switcher state ->', name);
    // 不再直接改写按钮内部结构，避免干扰 React 的 DOM 管理（会导致 removeChild 报错）
    // 仅通过可见性无关的属性传递当前模型信息。
    document.querySelectorAll(`[data-testid="${TEST_ID_SWITCHER}"]`).forEach((btn) => {
      try { btn.setAttribute('aria-label', `Model selector, current model is ${norm}`); } catch {}
      try { btn.setAttribute('title', `ChatGPT ${name}`); } catch {}
      btn.dataset.currentModel = norm;
    });
    try { window.__fmCurrentModel = norm; } catch {}
    try { updateStandaloneToggleLabel(); } catch {}
  }

  function updateAllSwitcherButtonsFromURL() {
    const url = new URL(window.location.href);
    const currentModel = url.searchParams.get('model');
    if (!currentModel) return;
    setAllSwitcherButtonsModel(currentModel);
  }

  function findAssociatedMenu(triggerBtn) {
    const id = triggerBtn.getAttribute('id');
    if (!id) return null;
    return document.querySelector(`[role="menu"][aria-labelledby="${CSS.escape(id)}"]`);
  }

  // 关闭（收起）与某按钮关联的 Main 模型选择器。
  function closeMenu(menuEl) {
    try {
      const menu = menuEl && (menuEl.closest?.('[role="menu"], [role="listbox"], [data-radix-menu-content]') || menuEl);
      if (!menu || !(menu instanceof HTMLElement)) return false;
      const labeledBy = menu.getAttribute('aria-labelledby');
      if (labeledBy) {
        const btn = document.getElementById(labeledBy);
        if (btn) {
          try { btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); } catch {}
          try { btn.click(); } catch {}
          return true;
        }
      }
      // 回退：发送 Escape 事件尝试关闭 Radix 下拉
      const target = document.activeElement || menu;
      try { target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true })); } catch {}
      try { target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true })); } catch {}
      return true;
    } catch {
      return false;
    }
  }

  // 仅识别“Main 模型选择器”（排除包含 Auto/Instant/Thinking/Pro 的“使用其他模型重试的模型选择器”）
  // Main 菜单识别：有 Main 菜单签名 + 不包含重试关键字
  function isOfficialModelMenu(menuEl) {
    if (!menuEl || !(menuEl instanceof HTMLElement)) return false;
    const role = menuEl.getAttribute('role');
    if (role !== 'menu' && role !== 'listbox') return false;
    const items = Array.from(menuEl.querySelectorAll('[role="menuitem"], [data-radix-collection-item]'));
    const labels = items.map((el) => {
      const t = el.querySelector?.('.truncate');
      const raw = (t?.textContent ?? el.textContent ?? '').trim();
      return raw.split('\n')[0].trim();
    });
    const hasVariantMarker = labels.some((l) => /^(Auto|Instant|Thinking(?: mini)?|Pro|Ultra(?:\s*Think(?:ing)?)?)$/i.test(l));
    if (hasVariantMarker) return false;
    const hasOfficialSignature = !!(menuEl.querySelector('[data-testid^="model-switcher-"]') || menuEl.querySelector('[data-cgpt-turn]'));
    if (!hasOfficialSignature) return false;
    return true;
  }

  // ---------------- 黏性重排 ----------------
  // 黏性重排：把“我们关心的项”按照订阅层级对应的顺序，
  // 仅在不一致时最小化 DOM 变动地整体移动，避免 hover 抖动/菜单意外关闭。
  const STICKY_REORDER = new WeakMap();

  function findItemNode(menu, id) {
    let node = menu.querySelector(`[data-radix-collection-item][data-testid="model-switcher-${CSS.escape(id)}"]`)
            || menu.querySelector(`[data-testid="model-switcher-${CSS.escape(id)}"]`)
            || menu.querySelector(`[data-custom-model="${CSS.escape(id)}"]`);
    if (!node && ALT_IDS[id]) {
      for (const alt of ALT_IDS[id]) {
        node = menu.querySelector(`[data-testid="model-switcher-${CSS.escape(alt)}"]`)
            || menu.querySelector(`[data-custom-model="${CSS.escape(alt)}"]`);
        if (node) break;
      }
    }
    return node;
  }

  // 对 Main 模型选择器进行“黏性重排”（与 addCustomModels 配合）。
  function applyDesiredOrder(menu) {
    // 1) 收集期望顺序中、当前实际存在于该菜单且“当前层级允许”的“顶层项”节点
    const desiredNodes = [];
    const seen = new Set();
    const desiredOrder = getDesiredOrder();
    for (const id of desiredOrder) {
      if (!isModelAllowed(id)) continue;
      let n = findItemNode(menu, id);
      if (!n) continue;
      // 升到以 menu 为直接父级的顶层容器，避免移动子层导致 hover 抖动
      while (n && n.parentElement && n.parentElement !== menu) n = n.parentElement;
      if (!n || seen.has(n)) continue;
      seen.add(n);
      desiredNodes.push(n);
    }
    if (desiredNodes.length === 0) return;

    // 2) 取当前顺序：按 menu.children 顺序过滤出我们关心的节点
    const current = Array.from(menu.children).filter(ch => seen.has(ch));

    // 3) 若顺序已匹配，则不做任何 DOM 变动（避免 pointerleave/blur 导致菜单关闭）
    const sameOrder = current.length === desiredNodes.length && current.every((n, i) => n === desiredNodes[i]);
    if (sameOrder) return;

    // 4) 仅在不一致时才整体移动，以最小化变更次数
    const frag = document.createDocumentFragment();
    desiredNodes.forEach(n => frag.appendChild(n));
    menu.appendChild(frag);
  }

  // UI 微调：压缩 GPT‑5 系列二行描述、统一标题、隐藏“Legacy models”入口和相关分隔线。
  function normalizeMenuUI(menu) {
    try {
      // 压缩 GPT‑5 系列项：去除第二行描述
      const g5 = menu.querySelectorAll('[data-testid^="model-switcher-gpt-5"], [data-radix-collection-item][data-testid^="model-switcher-gpt-5"]');
      g5.forEach((el) => {
        const container = el.querySelector('.min-w-0');
        if (!container) return;
        const children = Array.from(container.children);
        children.forEach((node, idx) => { if (idx >= 1 && node.tagName === 'DIV') node.remove(); });
      });
      // 标题规范化
      const rename = (key, text) => {
        const n = menu.querySelector(`[data-radix-collection-item][data-testid="model-switcher-${key}"] .min-w-0 span`)
              || menu.querySelector(`[data-testid="model-switcher-${key}"] .min-w-0 span`);
        if (n) n.textContent = text;
      };
      rename('gpt-5', 'GPT 5 Auto');
      rename('gpt-5-instant', 'GPT 5 Instant');
      rename('gpt-5-t-mini', 'GPT 5 Thinking Mini');
      rename('gpt-5-mini', 'GPT 5 mini');
      rename('gpt-5-thinking', 'GPT 5 Thinking');
      rename('gpt-5-pro', 'GPT 5 Pro');

      // 隐藏 Legacy models 子菜单入口
      const toHide = new Set();
      const exact = menu.querySelector('[data-testid="Legacy models-submenu"]');
      if (exact) toHide.add(exact);
      menu.querySelectorAll('[role="menuitem"][data-has-submenu]').forEach((el) => {
        const txt = (el.textContent || '').toLowerCase();
        const tid = (el.getAttribute('data-testid') || '').toLowerCase();
        if (txt.includes('legacy models') || tid.includes('legacy models')) toHide.add(el);
      });
      toHide.forEach((el) => { el.style.display = 'none'; el.setAttribute('data-ext-hidden','1'); });

      // 隐藏“GPT-5”分组标题与紧随的分隔线
      menu.querySelectorAll('div.__menu-label.mb-0').forEach((el) => {
        const t = (el.textContent || '').trim();
        if (t === 'GPT-5') {
          el.style.display = 'none';
          el.setAttribute('data-ext-hidden','1');
          const sep = el.nextElementSibling;
          if (sep && sep.getAttribute('role') === 'separator') {
            sep.style.display = 'none';
            sep.setAttribute('data-ext-hidden','1');
          }
        }
      });
      // 保险：具有这些类名的分隔线也隐藏
      menu.querySelectorAll('[role="separator"].bg-token-border-default.h-px.mx-4.my-1').forEach((el) => {
        el.style.display = 'none';
        el.setAttribute('data-ext-hidden','1');
      });
    } catch {}
  }

  // 按订阅层级隐藏/显示菜单项（官方项与自定义项均处理）
  function syncMenuByTier(menu) {
    try {
      // 遍历当前菜单中所有“模型项”（官方或自定义）
      const allItems = Array.from(menu.querySelectorAll('[data-radix-collection-item][data-testid^="model-switcher-"], [data-testid^="model-switcher-"]'));
      for (const el of allItems) {
        const testid = el.getAttribute('data-testid') || '';
        const m = /^model-switcher-(.+)$/.exec(testid);
        const id = m ? normalizeModelId(m[1]) : '';
        if (!id) continue;
        // 升为顶层节点
        let n = el;
        while (n && n.parentElement && n.parentElement !== menu) n = n.parentElement;
        const allowed = isModelAllowed(id);
        if (n && n instanceof HTMLElement) {
          if (allowed) {
            if (n.dataset.extTierHidden === '1') {
              n.style.display = '';
              delete n.dataset.extTierHidden;
            }
          } else {
            n.style.display = 'none';
            n.dataset.extTierHidden = '1';
          }
        }
      }
    } catch {}
  }

  function ensureStickyReorder(menu) {
    if (!menu || STICKY_REORDER.has(menu)) return;
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        try { normalizeMenuUI(menu); } catch {}
        try { syncMenuByTier(menu); } catch {}
        try { applyDesiredOrder(menu); } catch {}
      });
    };
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'childList') { schedule(); break; }
      }
    });
    mo.observe(menu, { childList: true });
    STICKY_REORDER.set(menu, mo);
    schedule(); // 首次也排一次
  }

  // ---------------- 自定义项：原生风格 + 丝滑选择 ----------------
  // 丝滑选择：
  // 1) 立即更新 URL 中的 ?model= 和顶部按钮文案（无闪烁），
  // 2) 再尝试点击同 id 的官方项（若可用），不做拦截改写（回归原始行为）。
  function selectModelQuick(id) {
    // 1) 立即更新 URL 和按钮文案（丝滑）
    if (!isModelAllowed(id)) {
      try { alert('当前订阅层级不可使用该模型'); } catch {}
      return;
    }
    try {
      const url = new URL(window.location.href);
      // url.searchParams.set('model', id); // 2.1: 暂停向 URL 写入 ?model 参数
      history.pushState({}, '', url.toString());
      try { window.dispatchEvent(new Event('pushstate')); } catch {}
      try { window.dispatchEvent(new Event('locationchange')); } catch {}
      try { window.dispatchEvent(new PopStateEvent('popstate')); } catch {}
      setAllSwitcherButtonsModel(id);
    } catch {}

    // 2) 联动点官方同 id 项（若成功可提前生效）
    const sel = `[data-radix-collection-item][data-testid="model-switcher-${CSS.escape(id)}"]:not([data-ext-custom])`;
    const tryClick = () => {
      const el = document.querySelector(sel);
      if (!el) return false;
      try { FM.info('click official menu item for', id); } catch {}
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      el.click();
      return true;
    };
    requestAnimationFrame(() => { if (!tryClick()) setTimeout(tryClick, 120); });
  }

  function createNativeLikeCustomItem(id, label) {
    const item = document.createElement('div');
    item.setAttribute('role','menuitem');
    item.setAttribute('tabindex','0');
    item.className = 'group __menu-item';
    item.setAttribute('data-radix-collection-item','');
    item.setAttribute('data-orientation','vertical');
    item.dataset.testid = `model-switcher-${id}`; // data-testid（保持一致，以便排序匹配）
    item.setAttribute('data-custom-model', id);
    item.setAttribute('data-ext-custom','1');    // 防止被“点官方项”逻辑误点

    item.innerHTML = `
      <div class="min-w-0">
        <span class="flex items-center gap-1">${label || id}</span>
      </div>
      <div class="trailing"><span class="icon"></span></div>
    `;

    const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };
    item.addEventListener('pointerdown', swallow, { capture: true });
    item.addEventListener('mousedown', swallow, { capture: true });
    item.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const menuRoot = item.closest('[role="menu"], [role="listbox"], [data-radix-menu-content]');
      try { FM.info('main choose -> sticky', id); } catch {}
      try { setForceSticky(id); } catch {}
      selectModelQuick(id);
      // 稍等一拍，确保原生项点击处理完成后再收起菜单
      if (!NO_CLOSE_ON_CHOOSE_IDS.has(normalizeModelId(id))) {
        setTimeout(() => { try { closeMenu(menuRoot); } catch {} }, 30);
      }
    }, { capture: true });
    return item;
  }

  // 在“Main 模型选择器”中插入自定义项（仅在该菜单没有同名原生项时）：
  // - 插在“最后一个 GPT‑5 官方项”之后（找不到则末尾）
  // - 插入后调用 normalizeMenuUI / applyDesiredOrder 统一外观与顺序
  function addCustomModels(menuEl) {
    if (!menuEl || !(menuEl instanceof HTMLElement)) return;
    if (menuEl.dataset.customized === 'true') return;

    // 在最后一个 GPT‑5 原生项后插入（找不到就追加到末尾）
    const anchors = menuEl.querySelectorAll('[data-radix-collection-item][data-testid^="model-switcher-gpt-5"]');
    const lastG5 = anchors[anchors.length - 1];

    for (const { id, label } of CUSTOM_MODELS) {
      // 过滤：订阅层级不允许的模型不插入
      if (!isModelAllowed(id)) continue;
      // 跳过：若菜单中已有原生同 id 项
      const existsOfficial = menuEl.querySelector(`[data-testid="model-switcher-${CSS.escape(id)}"]:not([data-ext-custom])`);
      if (existsOfficial) continue;
      // 跳过：已插过
      if (menuEl.querySelector(`[data-custom-model="${CSS.escape(id)}"]`)) continue;
      const item = createNativeLikeCustomItem(id, label || id);
      if (lastG5 && lastG5.parentElement === menuEl) lastG5.after(item); else menuEl.appendChild(item);
    }

    menuEl.dataset.customized = 'true';
    try { normalizeMenuUI(menuEl); } catch {}
    try { syncMenuByTier(menuEl); } catch {}
    try { applyDesiredOrder(menuEl); } catch {}

    // 若用户点选了官方项（或键盘触发 click），则自动收起菜单
    if (!menuEl.dataset.fmCloseOnChoose) {
      menuEl.addEventListener('click', (ev) => {
        const t = ev.target;
        if (!t || !(t instanceof Element)) return;
        const item = t.closest('[data-radix-collection-item][data-testid^="model-switcher-"]:not([data-ext-custom])')
                 || t.closest('[data-testid^="model-switcher-"]:not([data-ext-custom])');
        if (!item) return;
        const testid = item.getAttribute('data-testid') || '';
        const m = /^model-switcher-(.+)$/.exec(testid);
        const chosenId = m ? normalizeModelId(m[1]) : '';
        if (chosenId && !isModelAllowed(chosenId)) { ev.preventDefault(); ev.stopPropagation(); return; }
        // 官方主菜单项：选择即设为常驻拦截
        if (chosenId) { try { FM.info('main official choose -> sticky', chosenId); } catch {} try { setForceSticky(chosenId); } catch {} }
        if (chosenId && NO_CLOSE_ON_CHOOSE_IDS.has(chosenId)) return;
        setTimeout(() => { try { closeMenu(menuEl); } catch {} }, 30);
      }, { capture: true });
      menuEl.dataset.fmCloseOnChoose = '1';
    }
  }

  // ---------------- 使用其他模型重试的模型选择器：快捷项 + 强制窗口 + fetch 改写 ----------------
  let lastVariantMenuRoot = null;
  const isMenuRoot = (n) => n && n.nodeType === 1 && (
    n.matches?.('[data-radix-menu-content]') ||
    n.matches?.('[data-radix-dropdown-menu-content]') ||
    (n.getAttribute?.('role') === 'menu')
  );
  const VARIANT_MARKERS = [/^Auto$/i, /^Instant$/i, /^Thinking(?: mini)?$/i, /^Pro$/i, /^Ultra(?:\s*Think(?:ing)?)?$/i];
  function getItemLabel(el) {
    const t = el.querySelector?.('.truncate');
    const raw = (t?.textContent ?? el.textContent ?? '').trim();
    return raw.split('\n')[0].trim();
  }
  // “重试模型选择器”识别：包含关键字（Auto/Instant/Thinking/Pro/Ultra）+ 不含 Main 菜单签名。
  function isVariantMenu(root) {
    if (!isMenuRoot(root)) return false;
    // 排除 Main 模型选择器特征
    if (root.querySelector('[data-testid^="model-switcher-"]') || root.querySelector('[data-cgpt-turn]')) return false;
    const items = [...root.querySelectorAll('[role^="menuitem"]')];
    const hasVariant = items.some(el => VARIANT_MARKERS.some(re => re.test(getItemLabel(el))));
    return hasVariant;
  }
  // 回退“重试/Regenerate”按钮查找：当未能触发原生项时使用。
  function findRetryBtn() {
    let btn = document.querySelector('[data-testid*="regenerate"], [data-testid*="retry"]');
    if (btn) return btn;
    btn = [...document.querySelectorAll('button[aria-label]')].find(b => /regenerate|retry|重试|重新生成/i.test(b.getAttribute('aria-label') || ''));
    if (btn) return btn;
    btn = [...document.querySelectorAll('button')].find(b => /regenerate|retry|重试|重新生成/i.test((b.textContent || '').trim()));
    return btn || null;
  }
  // 在“重试模型选择器”中寻找一个“锚点项”（插入快捷项时作为参照）。
  function findNativeAnchor(root) {
    if (!root) return null;
    const items = [...root.querySelectorAll('[role^="menuitem"]')];
    const NATIVE_ANCHOR_TEXTS = [/^o4-mini$/i, /^gpt-4o$/i, /^gpt-4\.?1$/i];
    for (const re of NATIVE_ANCHOR_TEXTS) {
      const hit = items.find(el => re.test(getItemLabel(el)));
      if (hit) return hit;
    }
    return items[0] || null;
  }
  // 优先触发“重试模型选择器”里的原生项；若不存在则触发“重试/Regenerate”按钮。
  function clickNativeOrRetry() {
    // 优先直接触发“重试/Regenerate”，确保立即产生一次对话请求以消费一次性覆盖/抑制
    const retry = findRetryBtn();
    if (retry) {
      try { FM.info('variant click -> retry button'); } catch {}
      retry.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      retry.click();
      return true;
    }
    // 回退：点击一个稳定存在的原生锚点项（如 o4 mini / gpt-4o / gpt-4.1）
    const nativeItem = findNativeAnchor(lastVariantMenuRoot);
    if (nativeItem) {
      try { FM.info('variant click -> native anchor'); } catch {}
      nativeItem.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      nativeItem.click();
      return true;
    }
    console.warn('[fm] 未找到原生菜单项或“重试”按钮；请手动触发一次重试/选择模型。');
    return false;
  }
  // 拦截模型策略（更新后）：
  // - 兼容旧的“时间窗”方式（setForce），但默认采用“常驻拦截”。
  // - UI：左侧显示当前拦截状态，可取消。
  let forceModel = null; // 旧：时间窗（保留兼容，不默认使用）
  let forceUntil = 0;
  const inWindow = () => forceModel && Date.now() < forceUntil;
  function setForce(model, ms = 2000) { // 兼容旧逻辑（仍保留）
    forceModel = String(model || '').trim();
    forceUntil = Date.now() + ms;
    try { console.info(`[fm] force ${forceModel} for ${ms}ms`); } catch {}
    setTimeout(() => { if (Date.now() >= forceUntil) { forceModel = null; forceUntil = 0; } }, ms + 100);
  }

  // 常驻拦截（每个标签页独立生效）
  let forceModelSticky = null;      // 常驻拦截：始终改写为该模型（每个标签页独立）
  let forceModelOverrideOnce = null; // 临时重试覆盖：只对下一次请求生效，随后恢复常驻
  let suppressStickyUntil = 0;       // 临时抑制窗口：在窗口期内，下一次“会话请求”不应用常驻
  let stickyHardBlockUntil = 0;      // 硬阻断窗口：override armed 时，短时彻底禁用 sticky
  let interceptBadge = null;        // UI 元素
  let repositionTimer = null;       // 节流定位计时
  function setForceSticky(modelId) {
    forceModelSticky = String(modelId || '').trim();
    if (!forceModelSticky) return;
    try { FM.info('sticky on ->', forceModelSticky); } catch {}
    updateInterceptBadge('on');
    try { updateStandaloneToggleLabel(); } catch {}
  }
  function clearForceSticky() {
    forceModelSticky = null;
    try { FM.info('sticky off'); } catch {}
    updateInterceptBadge('off');
    try { updateStandaloneToggleLabel(); } catch {}
  }
  function setOverrideOnce(modelId) {
    forceModelOverrideOnce = String(modelId || '').trim();
    try { FM.info('override once ->', forceModelOverrideOnce); } catch {}
    // 不改徽标文字，保持显示常驻模型
    // 开一个硬阻断窗口：在 override 消耗前，sticky 完全不介入会话请求
    try { stickyHardBlockUntil = Date.now() + 15000; } catch {}
  }
  function clearOverrideOnce() {
    forceModelOverrideOnce = null;
    try { FM.info('override cleared'); } catch {}
  }
  function suppressStickyNext(label = '') {
    // 开启一个短窗口（10s），仅对“下一个会话请求”生效，并且只在真正的会话端点上消耗
    try { FM.info('suppress sticky window start by native retry ->', label); } catch {}
    suppressStickyUntil = Date.now() + 10000;
  }
  // 无单次消耗逻辑

  function ensureInterceptBadge() {
    // 若已有，直接复用；顺便清理重复的旧节点
    const exist = document.getElementById('fm-intercept-badge');
    if (exist) {
      interceptBadge = exist;
      // 清理重复
      const dups = document.querySelectorAll('#fm-intercept-badge');
      if (dups.length > 1) {
        dups.forEach((n, i) => { if (i > 0 && n !== exist) n.remove(); });
      }
      try { FM.log('badge reuse'); } catch {}
      return exist;
    }

    const badge = document.createElement('div');
    badge.id = 'fm-intercept-badge';
    badge.style.position = 'fixed';
    badge.style.left = '10px'; // 初始占位，稍后会靠近模型选择器
    badge.style.top = '10px';
    badge.style.zIndex = '9999999999';
    badge.style.pointerEvents = 'auto';
    badge.style.padding = '3px 8px';
    badge.style.borderRadius = '999px';
    badge.style.fontSize = '12px';
    badge.style.lineHeight = '1.2';
    badge.style.background = 'var(--token-surface-brand, #10a37f)';
    badge.style.color = '#fff';
    badge.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
    badge.style.userSelect = 'none';
    badge.style.cursor = 'default';
    badge.style.display = 'none';
    badge.style.maxWidth = '220px';
    badge.style.whiteSpace = 'nowrap';
    badge.style.overflow = 'hidden';
    badge.style.textOverflow = 'ellipsis';

    const text = document.createElement('span');
    text.id = 'fm-intercept-text';
    badge.appendChild(text);

    const spacer = document.createElement('span');
    spacer.textContent = ' ';
    badge.appendChild(spacer);

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '×';
    cancel.style.marginLeft = '6px';
    cancel.style.fontSize = '12px';
    cancel.style.padding = '2px 6px';
    cancel.style.border = 'none';
    cancel.style.borderRadius = '999px';
    cancel.style.background = 'transparent';
    cancel.style.color = 'inherit';
    cancel.addEventListener('click', (e) => {
      e.stopPropagation(); e.preventDefault();
      try { FM.info('badge cancel clicked'); } catch {}
      clearForceSticky();
    });
    badge.appendChild(cancel);

    const container = document.body || document.documentElement;
    container.appendChild(badge);
    interceptBadge = badge;
    try { FM.log('badge create'); } catch {}
    return badge;
  }
  function getVisibleSwitcherBtn() {
    const list = document.querySelectorAll(`[data-testid="${TEST_ID_SWITCHER}"]`);
    for (const el of list) {
      const rect = el.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.left < (window.innerWidth || 0) && rect.top < (window.innerHeight || 0);
      if (visible) return el;
    }
    // fallback: use standalone toggle if visible
    const fallback = document.getElementById('fm-standalone-toggle');
    if (fallback) {
      try {
        const r = fallback.getBoundingClientRect();
        const ok = r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.left < (window.innerWidth || 0) && r.top < (window.innerHeight || 0);
        if (ok) return fallback;
      } catch {}
    }
    return null;
  }

  // ---------------- 独立模型选择器（在无官方切换按钮的页面提供入口） ----------------
  function hasNativeSwitcherVisible() {
    const list = document.querySelectorAll(`[data-testid="${TEST_ID_SWITCHER}"]`);
    for (const el of list) {
      const rect = el.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.left < (window.innerWidth || 0) && rect.top < (window.innerHeight || 0);
      if (visible) return true;
    }
    return false;
  }

  function buildStandaloneMenuItems(menu) {
    if (!menu) return;
    menu.textContent = '';
    const desired = getDesiredOrder();
    const used = new Set();
    for (const id of desired) {
      if (used.has(id)) continue;
      used.add(id);
      if (!isModelAllowed(id)) continue;
      const item = document.createElement('div');
      item.className = '__fm-standalone-item';
      item.setAttribute('data-model-id', id);
      item.textContent = prettyName(id);
      item.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        try { setForceSticky(id); } catch {}
        try { selectModelQuick(id); } catch {}
        try { hideStandaloneMenu(); } catch {}
      });
      menu.appendChild(item);
    }
  }

  function getCurrentModelIdForDisplay() {
    // 1) 优先显示常驻模型
    if (forceModelSticky) return normalizeModelId(forceModelSticky);
    // 2) 取可见原生按钮标记的当前模型
    const list = document.querySelectorAll(`[data-testid="${TEST_ID_SWITCHER}"]`);
    for (const el of list) {
      try {
        const rect = el.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.left < (window.innerWidth || 0) && rect.top < (window.innerHeight || 0);
        const cur = (el.dataset && el.dataset.currentModel) ? normalizeModelId(el.dataset.currentModel) : '';
        if (visible && cur) return cur;
      } catch {}
    }
    // 3) 退回到脚本记录的最近一次
    const cur = (window.__fmCurrentModel || '').toString();
    return normalizeModelId(cur);
  }

  function updateStandaloneToggleLabel() {
    const btn = document.getElementById('fm-standalone-toggle');
    if (!btn) return;
    const id = getCurrentModelIdForDisplay();
    const name = id ? prettyName(id) : '选择模型';
    btn.textContent = name;
    try { btn.setAttribute('title', `当前模型：${name}`); } catch {}
  }

  function updateStandaloneSelection(menu) {
    if (!menu) return;
    const current = normalizeModelId((window.__fmCurrentModel || '') || (forceModelSticky || ''));
    menu.querySelectorAll('.__fm-standalone-item').forEach((el) => {
      const id = normalizeModelId(el.getAttribute('data-model-id') || '');
      el.classList.toggle('is-active', !!current && id === current);
    });
  }

  function hideStandaloneMenu() {
    const menu = document.getElementById('fm-standalone-menu');
    if (menu) menu.style.display = 'none';
  }

  function toggleStandaloneMenu() {
    const menu = document.getElementById('fm-standalone-menu');
    if (!menu) return;
    const show = menu.style.display === 'none' || !menu.style.display;
    if (show) {
      buildStandaloneMenuItems(menu);
      updateStandaloneSelection(menu);
      menu.style.display = '';
    } else {
      menu.style.display = 'none';
    }
  }

  function ensureStandaloneSwitcher() {
    const exists = document.getElementById('fm-standalone-switcher');
    const need = !hasNativeSwitcherVisible();
    if (!need) {
      if (exists) exists.style.display = 'none';
      return;
    }
    let box = exists;
    if (!box) {
      box = document.createElement('div');
      box.id = 'fm-standalone-switcher';
      box.style.position = 'fixed';
      box.style.left = '16px';
      box.style.top = '16px';
      box.style.zIndex = '9999999999';
      box.style.fontSize = '14px';
      box.style.userSelect = 'none';
      box.style.pointerEvents = 'auto';
      const btn = document.createElement('button');
      btn.id = 'fm-standalone-toggle';
      btn.type = 'button';
      btn.style.padding = '4px 10px';
      btn.style.borderRadius = '8px';
      btn.style.border = '1px solid var(--token-border, rgba(0,0,0,0.1))';
      btn.style.background = 'var(--token-surface-primary, #fff)';
      btn.style.color = 'var(--token-text-primary, #111)';
      btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
      btn.style.fontSize = '12px';
      btn.style.fontWeight = '500';
      btn.style.maxWidth = '240px';
      btn.style.whiteSpace = 'nowrap';
      btn.style.overflow = 'hidden';
      btn.style.textOverflow = 'ellipsis';
      btn.addEventListener('click', (e) => { e.stopPropagation(); toggleStandaloneMenu(); });
      const menu = document.createElement('div');
      menu.id = 'fm-standalone-menu';
      menu.style.position = 'absolute';
      menu.style.left = '0';
      menu.style.top = '42px';
      menu.style.minWidth = '180px';
      menu.style.maxHeight = '60vh';
      menu.style.overflow = 'auto';
      menu.style.padding = '6px';
      menu.style.borderRadius = '12px';
      menu.style.background = 'var(--token-surface-primary, #fff)';
      menu.style.border = '1px solid var(--token-border, rgba(0,0,0,0.12))';
      menu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)';
      menu.style.display = 'none';
      // click outside to close
      document.addEventListener('click', (ev) => {
        const t = ev.target;
        if (!t || !(t instanceof Element)) return;
        if (t.closest('#fm-standalone-switcher')) return;
        hideStandaloneMenu();
      }, { capture: true });
      box.appendChild(btn);
      box.appendChild(menu);
      (document.body || document.documentElement).appendChild(box);
      // style for items
      const style = document.getElementById('fm-standalone-style') || document.createElement('style');
      style.id = 'fm-standalone-style';
      style.textContent = `
        #fm-standalone-menu { font-size: 14px; }
        #fm-standalone-menu .__fm-standalone-item {
          padding: 8px 10px; border-radius: 8px; cursor: pointer;
          color: var(--token-text-primary, #111);
        }
        #fm-standalone-menu .__fm-standalone-item:hover {
          background: var(--token-surface-secondary, rgba(0,0,0,0.04));
        }
        #fm-standalone-menu .__fm-standalone-item.is-active {
          background: var(--token-surface-brand, #10a37f); color: #fff;
        }
      `;
      document.documentElement.appendChild(style);
      // 初始化按钮显示文案
      try { updateStandaloneToggleLabel(); } catch {}
    }
    box.style.display = '';
  }
  function positionBadgeNearSwitcher() {
    const b = ensureInterceptBadge();
    if (!b || b.style.display === 'none') return; // 不显示时无需定位
    const btn = getVisibleSwitcherBtn();
    if (!btn) {
      // 找不到目标时，回到左上角不遮挡
      b.style.left = '10px';
      b.style.top = '10px';
      b.style.transform = 'none';
      return;
    }
    const r = btn.getBoundingClientRect();
    const left = Math.min(r.right + 8, (window.innerWidth || 0) - 10 - b.offsetWidth);
    const top = Math.max(10, Math.min(r.top + r.height / 2, (window.innerHeight || 0) - 10));
    b.style.left = `${Math.max(10, left)}px`;
    b.style.top = `${top}px`;
    b.style.transform = 'translateY(-50%)';
  }
  function scheduleReposition() {
    if (repositionTimer) cancelAnimationFrame(repositionTimer);
    repositionTimer = requestAnimationFrame(positionBadgeNearSwitcher);
  }
  function updateInterceptBadge(state = 'auto') {
    const b = ensureInterceptBadge();
    const txt = b.querySelector('#fm-intercept-text');
    const modelName = prettyName(forceModelSticky || '');
    const buttons = b.querySelectorAll('button');
    const cancelBtn = buttons[0];

    if (state === 'off' || !forceModelSticky) {
      b.style.display = 'none';
      try { FM.info('badge off'); } catch {}
      return;
    }
    // on
    b.style.display = '';
    b.style.background = 'var(--token-surface-brand, #10a37f)';
    txt.textContent = `常驻模型：${modelName}`;
    if (cancelBtn) cancelBtn.style.display = '';
    scheduleReposition();
    try { FM.info('badge show ->', modelName); } catch {}
  }
  const CONVO_RE = /\/backend-api\/(f\/)?conversation(?:$|\?)/;
  const BACKEND_RE = /\/backend-api\//i;
  const ANALYTICS_RE = /\/ces\/v1\/t(?:$|[/?#])/;
  const origFetch = W.fetch;
  // 判断是否为 JSON 请求体（尽量避免对 multipart/form-data 等误判导致的 JSON 解析报错）
  function isJsonRequest(req, init, bodyTxt) {
    try {
      const h = (req && req.headers) ? req.headers : (init && init.headers);
      let ct = '';
      if (h) {
        try { ct = (typeof h.get === 'function') ? (h.get('content-type') || '') : (Array.isArray(h) ? (h.find(([k]) => String(k).toLowerCase() === 'content-type')?.[1] || '') : (h['Content-Type'] || h['content-type'] || '')); } catch {}
      }
      ct = String(ct || '').toLowerCase();
      if (ct.includes('application/json')) return true;
      // 进一步兜底：快速判断文本是否像 JSON
      const t = String(bodyTxt || '').trim();
      return t.startsWith('{') || t.startsWith('[');
    } catch { return false; }
  }
  W.fetch = async function(input, init) {
    try {
      const req = (input instanceof Request) ? input : new Request(input, init);
      const url = req.url || (typeof input === 'string' ? input : '');
      const method = (req.method || (init && init.method) || 'GET').toUpperCase();
      const isBackend = BACKEND_RE.test(url);
      // 监听 Analytics：Model Switcher 事件，提取 target model 更新按钮文案
      if (ANALYTICS_RE.test(url) && method === 'POST') {
        try {
          const txt = await req.clone().text();
          if (txt) {
            try {
              const data = JSON.parse(txt);
              const evt = String(data?.event || '');
              const p = data?.properties || {};
              const to = p.to || p.model || p.value || p.selection || p.target;
              if (/Model\s*Switcher/i.test(evt) && to) {
                setAllSwitcherButtonsModel(to);
              }
            } catch {}
          }
        } catch {}
        // 透传
        return origFetch(input, init);
      }
      // 仅在 POST 且看起来是 JSON 的情况下再尝试解析与改写，避免无意义的解析报错
      if (method !== 'POST') { return origFetch(input, init); }
      let bodyTxt = '';
      try { bodyTxt = await req.clone().text(); } catch {}
      if (!bodyTxt) {
        // 没有可读 body：若 override armed，严格禁止 sticky 介入后台会话请求
        if (forceModelOverrideOnce && isBackend && Date.now() < stickyHardBlockUntil) {
          try { FM.info('fetch: hard block sticky (no body, backend)'); } catch {}
          return origFetch(input, init);
        }
        return origFetch(input, init);
      }
      if (!isJsonRequest(req, init, bodyTxt)) {
        // 非 JSON：若 override armed，严格禁止 sticky 介入后台会话请求
        if (forceModelOverrideOnce && isBackend && Date.now() < stickyHardBlockUntil) {
          try { FM.info('fetch: hard block sticky (non-json, backend)'); } catch {}
          return origFetch(input, init);
        }
        return origFetch(input, init);
      }
      try {
        const body = JSON.parse(bodyTxt);
        const wantOnce = forceModelOverrideOnce || null;
        const stickyBase = forceModelSticky || (inWindow() ? forceModel : null);
        const action = String(body?.action || '').toLowerCase();
        const hasModelKey = Object.prototype.hasOwnProperty.call(body || {}, 'model');
        const stickyActions = new Set(['variant','next','continue','create','creation','reply','submit','resume']);
        const CONV_URL_RE = /\/backend-api\/(f\/)?(conversation|chat|messages|compact)(?:$|[?/#])/i;
        const isConvPath = CONV_URL_RE.test(url);
        const looksLikeConversation = hasModelKey || stickyActions.has(action) || isConvPath || /\b(messages|input_text|prompt|conversation_id|parent_message_id)\b/.test(bodyTxt);
        const looksLikeGeneration = isConvPath && (hasModelKey || stickyActions.has(action) || /\b(messages|input_text|prompt)\b/.test(bodyTxt));

        // 0) 硬阻断：override armed 时，无论是否能改写 body，都阻断 sticky
        const hardBlockSticky = !!(wantOnce && Date.now() < stickyHardBlockUntil);

        // 1) 重试覆盖：严格要求命中“会话端点”才消耗与改写；若未命中则不消耗，但 sticky 也不介入（硬阻断）
        if (wantOnce && isConvPath && looksLikeGeneration) {
          const old = body.model;
          body.model = wantOnce;
          const newTxt = JSON.stringify(body);
          // 复制 headers，确保为 JSON，并避免遗留 content-length
          const headers = new Headers(req.headers || (init && init.headers) || undefined);
          try { headers.set('content-type', 'application/json'); headers.delete('content-length'); } catch {}
          const newInit = {
            method: req.method || (init && init.method) || 'POST',
            headers,
            body: newTxt,
            credentials: req.credentials,
            cache: req.cache,
            mode: req.mode,
            redirect: req.redirect,
            referrer: req.referrer,
            referrerPolicy: req.referrerPolicy,
            integrity: req.integrity,
            keepalive: req.keepalive,
            signal: req.signal,
          };
          // 保留/补充 duplex 以兼容 Chrome 的半双工请求（站点常用于流式接口）
          try { if (init && 'duplex' in init) newInit.duplex = init.duplex; else newInit.duplex = 'half'; } catch {}
          try { FM.info(`rewrite model: ${old} -> ${body.model} | action=${body.action} | override=true`); } catch {}
          clearOverrideOnce();
          return origFetch(req.url, newInit);
        }

        // 2) 抑制常驻：在窗口期内，仅当命中真正的会话端点时才消耗一次
        if (suppressStickyUntil > 0) {
          const now = Date.now();
          if (now < suppressStickyUntil && looksLikeGeneration) {
            try { FM.info('suppress sticky for this conversation request | action=', action || '(n/a)'); } catch {}
            suppressStickyUntil = 0; // 仅消耗一次
            return origFetch(input, init);
          }
          // 过期自动清理
          if (now >= suppressStickyUntil) suppressStickyUntil = 0;
        }

        // 3) 常驻：仅对“会话端点”应用；当 override armed 且处于硬阻断窗口时，跳过 sticky
        if (stickyBase && looksLikeGeneration && !(forceModelOverrideOnce && hardBlockSticky)) {
          const old = body.model;
          body.model = stickyBase;
          const newTxt = JSON.stringify(body);
          const headers = new Headers(req.headers || (init && init.headers) || undefined);
          try { headers.set('content-type', 'application/json'); headers.delete('content-length'); } catch {}
          const newInit = {
            method: req.method || (init && init.method) || 'POST',
            headers,
            body: newTxt,
            credentials: req.credentials,
            cache: req.cache,
            mode: req.mode,
            redirect: req.redirect,
            referrer: req.referrer,
            referrerPolicy: req.referrerPolicy,
            integrity: req.integrity,
            keepalive: req.keepalive,
            signal: req.signal,
          };
          try { if (init && 'duplex' in init) newInit.duplex = init.duplex; else newInit.duplex = 'half'; } catch {}
          try { FM.info(`rewrite model: ${old} -> ${body.model} | action=${body.action} | sticky=true`); } catch {}
          return origFetch(req.url, newInit);
        }

        // override armed 但未命中会话请求：避免 sticky 介入，透传
        if (forceModelOverrideOnce && hardBlockSticky && isBackend) {
          try { FM.info('fetch: override armed, skip sticky (backend pass-through)'); } catch {}
          return origFetch(input, init);
        }
      } catch (e) {
        // 仅在看起来是会话相关接口时提示解析问题；其他 POST（如上传/打点）静默忽略
        try {
          const looksLikeConv = /\/backend-api\//i.test(req.url || '') || /\b(messages|input_text|prompt)\b/.test(bodyTxt || '');
          if (looksLikeConv) FM.warn('rewrite parse error', e?.message || e);
        } catch {}
      }
      return origFetch(input, init);
    } catch (err) {
      return origFetch(input, init);
    }
  };

  // 在“重试模型选择器”构造一个与原生风格一致的快捷项，
  // 点击后：设置“常驻强制模型” -> 更新按钮文案 -> 触发原生项或重试。
  function createVariantMenuItem({label, sub, slug}) {
    const span = document.createElement('span');
    const item = document.createElement('div');
    item.setAttribute('role', 'menuitem');
    item.setAttribute('tabindex', '0');
    item.className = 'group __menu-item';
    item.dataset.orientation = 'vertical';
    item.setAttribute('data-radix-collection-item', '');
    const subLine = sub ? `<div class="not-group-data-disabled:text-token-text-tertiary leading-dense mb-0.5 text-xs group-data-sheet-item:mt-0.5 group-data-sheet-item:mb-0">${sub}</div>` : '';
    item.innerHTML = `
      <div class="min-w-0">
        <div class="flex min-w-0 grow items-center gap-2.5 group-data-no-contents-gap:gap-0">
          <div class="truncate">${label}</div>
        </div>
        ${subLine}
      </div>
    `;
    const onChoose = (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const targetModel = slug || label;
      try { FM.info('variant choose -> override once', targetModel); } catch {}
      // 重试菜单：仅设置一次性覆盖，优先级高于常驻；消耗后恢复常驻
      setOverrideOnce(targetModel);
      // 同时抑制一次常驻，防止在极端情况下（如请求体非 JSON/解析失败）仍被常驻覆盖
      suppressStickyNext('variant-quick');
      // 兼容旧的 2 秒时间窗策略，作为兜底（与一次性覆盖共同作用）
      try { setForce(targetModel, 2000); } catch {}
      setTimeout(() => {
        const ok = clickNativeOrRetry();
        if (!ok) console.warn('[fm] 没能自动触发；你可手动点一次重试，窗口仍然生效。');
      }, 10);
    };
    item.addEventListener('click', onChoose);
    span.appendChild(item);
    span.dataset.fmItem = '1';
    return span;
  }
  // 在“重试模型选择器”中找到锚点项，并在其后插入若干快捷项。
  function enhanceVariantMenu(root) {
    if (!root || root.dataset.fmAugmented) return;
    if (!isVariantMenu(root)) return;
    root.dataset.fmAugmented = '1';
    lastVariantMenuRoot = root;
    if (root.querySelector('[data-fmItem="1"]')) return;
    const items = root.querySelectorAll('[role^="menuitem"]');
    let anchor = null;
    const NATIVE_ANCHOR_TEXTS = [/^o4-mini$/i, /^gpt-4o$/i, /^gpt-4\.?1$/i];
    for (const re of NATIVE_ANCHOR_TEXTS) {
      anchor = Array.from(items).find(el => re.test(getItemLabel(el)));
      if (anchor) break;
    }
    if (!anchor) return;
    const anchorSpan = anchor.closest('span') || anchor;
    const ALL_QUICK = [
      { label: 'o3 pro',       slug: 'o3-pro' },
      { label: 'GPT 5 mini',   slug: 'gpt-5-mini' },
      { label: 'o4 mini high', slug: 'o4-mini-high' },
      { label: 'GPT 4.5',      slug: 'gpt-4-5' },
    ];
    const QUICK_MODELS = ALL_QUICK.filter(q => isModelAllowed(q.slug));
    QUICK_MODELS.forEach(q => {
      const node = createVariantMenuItem(q);
      anchorSpan.parentNode.insertBefore(node, anchorSpan.nextSibling);
    });

    // 捕获原生菜单项点击：当用户点击 Auto/Instant/Thinking/Pro/Ultra 等原生项时，
    // 不去猜测具体模型，而是抑制一次常驻改写，让站点自带的模型值生效。
    if (!root.dataset.fmBindNativeClick) {
      const handler = (ev) => {
        const t = ev.target;
        if (!t || !(t instanceof Element)) return;
        // 排除我们插入的快捷项
        if (t.closest('[data-fmItem="1"]')) return;
        const item = t.closest('[role^="menuitem"]');
        if (!item) return;
        const label = getItemLabel(item);
        // 原生变体项：无条件抑制一次常驻，让原生本次生效
        suppressStickyNext(label);
      };
      root.addEventListener('click', handler, { capture: true });
      root.addEventListener('pointerdown', handler, { capture: true });
      root.dataset.fmBindNativeClick = '1';
    }
  }

  // ---------------- 观察与启动 ----------------
  // 与“顶部切换按钮”绑定的观察器：
  // - 通过按钮 id → 菜单 aria-labelledby 关联，拿到对应菜单；
  // - 根据菜单类型路由到 addCustomModels（Main）或 enhanceVariantMenu（重试）。
  function installMenuObserverFor(triggerBtn) {
    const debounced = debounce(() => {
      const menu = findAssociatedMenu(triggerBtn);
      if (menu && isOfficialModelMenu(menu)) {
        addCustomModels(menu);
        ensureStickyReorder(menu);
      }
    }, 50);
    const bodyObserver = new MutationObserver(() => { debounced(); });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
    debounced();
    const attrObs = new MutationObserver(() => debounced());
    attrObs.observe(triggerBtn, { attributes: true, attributeFilter: ['aria-expanded', 'id'] });
  }

  // 启动：
  // - 监听并附着顶部切换按钮，首次点击时安装菜单观察器；
  // - 全局 MutationObserver 兜底，发现任意新菜单后按类型处理；
  // - 监听 URL 变化同步按钮文案。
  function bootstrap() {
    // 首次运行层级选择（仅一次）
    ensureTierChosen();
    const attach = (btn) => {
      if (!(btn instanceof HTMLElement)) return;
      if (btn.dataset.orderMergedEnhanced === 'true') return;
      btn.dataset.orderMergedEnhanced = 'true';
      btn.addEventListener('click', () => { installMenuObserverFor(btn); }, { once: true });
      updateAllSwitcherButtonsFromURL();
    };
    document.querySelectorAll(`[data-testid="${TEST_ID_SWITCHER}"]`).forEach(attach);
    const obsButtons = new MutationObserver(() => { document.querySelectorAll(`[data-testid="${TEST_ID_SWITCHER}"]`).forEach(attach); });
    obsButtons.observe(document.body, { childList: true, subtree: true });
    // 独立模型选择器：在无官方按钮时提供入口
    ensureStandaloneSwitcher();
    const obsStandalone = new MutationObserver(() => { ensureStandaloneSwitcher(); scheduleReposition(); });
    obsStandalone.observe(document.body, { childList: true, subtree: true });

    // 全局兜底：任意新开的菜单，按类型分别处理（Main/重试）
    const menuObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          const candidates = [];
          if (node.matches?.('[role="menu"], [role="listbox"], [data-radix-menu-content]')) candidates.push(node);
          node.querySelectorAll?.('[role="menu"], [role="listbox"], [data-radix-menu-content]').forEach((el) => candidates.push(el));
          for (const el of candidates) {
            const menu = el.getAttribute('role') ? el : el.querySelector?.('[role="menu"], [role="listbox"]');
            if (!menu) continue;
            if (isOfficialModelMenu(menu)) {
              addCustomModels(menu);
              ensureStickyReorder(menu);
            } else if (isVariantMenu(menu)) {
              enhanceVariantMenu(menu);
            }
          }
        }
      }
    });
    menuObserver.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('popstate', () => { updateAllSwitcherButtonsFromURL(); scheduleReposition(); });
    window.addEventListener('pushstate', () => { updateAllSwitcherButtonsFromURL(); scheduleReposition(); });
    window.addEventListener('locationchange', () => { updateAllSwitcherButtonsFromURL(); scheduleReposition(); });
    window.addEventListener('resize', scheduleReposition, { passive: true });
    window.addEventListener('scroll', scheduleReposition, { passive: true, capture: true });
    // 确保拦截状态徽标已就绪并尝试定位
    try { ensureInterceptBadge(); scheduleReposition(); } catch {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }

  // 样式：保证自定义项文本色 + 隐藏特定分隔线
  const style = document.createElement('style');
  style.id = 'chatgpt-order-merged-style';
  style.textContent = `
    [data-custom-model] { color: var(--token-text-primary, var(--text-primary, inherit)) !important; }
    [data-custom-model] * { color: inherit !important; }
    [data-testid="Legacy models-submenu"] { display: none !important; }
    [role="separator"].bg-token-border-default.h-px.mx-4.my-1 { display: none !important; }
  `;
  document.documentElement.appendChild(style);

  // 额外兜底：拦截 XHR（部分页面可能用 XHR 发送对话请求）
  try {
    const P = XMLHttpRequest.prototype;
    const origOpen = P.open;
    const origSend = P.send;
    const origSetHeader = P.setRequestHeader;
    P.open = function(method, url, async, user, password) {
      try {
        this.__fm = this.__fm || {};
        this.__fm.method = String(method || '').toUpperCase();
        this.__fm.url = String(url || '');
        this.__fm.headers = {};
      } catch {}
      return origOpen.apply(this, arguments);
    };
    P.setRequestHeader = function(k, v) {
      try {
        if (this.__fm && this.__fm.headers) { this.__fm.headers[String(k || '').toLowerCase()] = String(v || ''); }
      } catch {}
      return origSetHeader.apply(this, arguments);
    };
    P.send = function(body) {
      try {
        const info = this.__fm || {};
        const method = String(info.method || '').toUpperCase();
        const url = String(info.url || '');
        const isBackend = BACKEND_RE.test(url);
        if (method !== 'POST') return origSend.apply(this, arguments);

        let txt = null;
        if (typeof body === 'string') txt = body;
        // 仅处理字符串 JSON；其他类型（FormData/Blob）不改写，保持安全
        if (!txt) {
          // override armed → 硬阻断 sticky，对 backend 直接透传
          if (forceModelOverrideOnce && isBackend && Date.now() < stickyHardBlockUntil) {
            try { FM.info('xhr: hard block sticky (non-string body, backend)'); } catch {}
            return origSend.apply(this, arguments);
          }
          return origSend.apply(this, arguments);
        }

        // 快速判定是否像 JSON
        const likeJson = /^\s*[{\[]/.test(txt);
        if (!likeJson) {
          if (forceModelOverrideOnce && isBackend && Date.now() < stickyHardBlockUntil) {
            try { FM.info('xhr: hard block sticky (non-json text)'); } catch {}
            return origSend.apply(this, arguments);
          }
          return origSend.apply(this, arguments);
        }

        try {
          const data = JSON.parse(txt);
          const wantOnce = forceModelOverrideOnce || null;
          const stickyBase = forceModelSticky || (inWindow() ? forceModel : null);
          const action = String(data?.action || '').toLowerCase();
          const hasModelKey = Object.prototype.hasOwnProperty.call(data || {}, 'model');
          const stickyActions = new Set(['variant','next','continue','create','creation','reply','submit','resume']);
          const CONV_URL_RE = /\/backend-api\/(f\/)?(conversation|chat|messages|compact)(?:$|[?/#])/i;
          const isConvPath = CONV_URL_RE.test(url);
          const looksLikeGeneration = isConvPath && (hasModelKey || stickyActions.has(action) || /\b(messages|input_text|prompt)\b/.test(txt));
          const hardBlockSticky = !!(wantOnce && Date.now() < stickyHardBlockUntil);

          // 优先：override once
          if (wantOnce && isConvPath && looksLikeGeneration) {
            const old = data.model;
            data.model = wantOnce;
            const newTxt = JSON.stringify(data);
            try { this.setRequestHeader('content-type', 'application/json'); } catch {}
            try { FM.info(`xhr rewrite model: ${old} -> ${data.model} | action=${data.action} | override=true`); } catch {}
            clearOverrideOnce();
            return origSend.call(this, newTxt);
          }

          // 抑制 sticky 窗口
          if (suppressStickyUntil > 0) {
            const now = Date.now();
            if (now < suppressStickyUntil && looksLikeGeneration) {
              try { FM.info('xhr suppress sticky for this conversation request'); } catch {}
              suppressStickyUntil = 0;
              return origSend.apply(this, arguments);
            }
            if (now >= suppressStickyUntil) suppressStickyUntil = 0;
          }

          // sticky：在无硬阻断时应用
          if (stickyBase && looksLikeGeneration && !(forceModelOverrideOnce && hardBlockSticky)) {
            const old = data.model;
            data.model = stickyBase;
            const newTxt = JSON.stringify(data);
            try { this.setRequestHeader('content-type', 'application/json'); } catch {}
            try { FM.info(`xhr rewrite model: ${old} -> ${data.model} | action=${data.action} | sticky=true`); } catch {}
            return origSend.call(this, newTxt);
          }

          // override armed 未命中：阻断 sticky，透传
          if (forceModelOverrideOnce && hardBlockSticky && isBackend) {
            try { FM.info('xhr: override armed, skip sticky (backend pass-through)'); } catch {}
            return origSend.apply(this, arguments);
          }

        } catch (e) {
          try { FM.warn('xhr parse error', e?.message || e); } catch {}
        }
        return origSend.apply(this, arguments);
      } catch (err) {
        return origSend.apply(this, arguments);
      }
    };
  } catch {}
})();
