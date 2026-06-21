(function initGrouping(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.TabOutGrouping = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function groupingFactory() {
  'use strict';

  const TAB_GROUP_NONE = -1;

  const DEFAULT_LANDING_PAGE_PATTERNS = [
    {
      hostname: 'mail.google.com',
      test: (_path, href) =>
        !href.includes('#inbox/') &&
        !href.includes('#sent/') &&
        !href.includes('#search/'),
    },
    { hostname: 'x.com', pathExact: ['/home'] },
    { hostname: 'www.linkedin.com', pathExact: ['/'] },
    { hostname: 'github.com', pathExact: ['/'] },
    { hostname: 'www.youtube.com', pathExact: ['/'] },
  ];

  function isUserFacingTabUrl(url) {
    if (!url) return false;

    try {
      return ['http:', 'https:', 'file:'].includes(new URL(url).protocol);
    } catch {
      return false;
    }
  }

  function normalizeUrlKey(url) {
    return String(url || '').trim();
  }

  function parseUrl(url) {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  }

  function hostnameFromUrl(url) {
    const parsed = parseUrl(url);
    if (!parsed) return '';
    if (parsed.protocol === 'file:') return 'local-files';
    return parsed.hostname || '';
  }

  function compactHostname(hostname) {
    return String(hostname || '').replace(/^www\./, '');
  }

  function siteFromUrl(url) {
    const hostname = hostnameFromUrl(url);
    if (!hostname) return 'unknown';
    if (hostname === 'local-files') return 'local-files';
    return compactHostname(hostname);
  }

  function friendlyDomain(domain) {
    if (!domain) return 'Unknown';
    if (domain === '__landing-pages__') return 'Homepages';
    if (domain === 'local-dev') return 'Local/dev';
    if (domain === 'local-files') return 'Local files';
    const parts = compactHostname(domain)
      .split('.')
      .filter(Boolean);
    if (parts.length > 1 && ['com', 'org', 'net', 'io', 'dev', 'app'].includes(parts[parts.length - 1])) {
      parts.pop();
    }
    return parts
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  function isLocalDevUrl(url) {
    const parsed = parseUrl(url);
    if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) return false;
    const host = parsed.hostname;
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.localhost') ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    );
  }

  function matchesPattern(pattern, url) {
    const parsed = parseUrl(url);
    if (!parsed || !pattern) return false;

    const hostnameMatch = pattern.hostname
      ? parsed.hostname === pattern.hostname
      : pattern.hostnameEndsWith
        ? parsed.hostname.endsWith(pattern.hostnameEndsWith)
        : false;

    if (!hostnameMatch) return false;
    if (pattern.test) return !!pattern.test(parsed.pathname, url);
    if (pattern.pathPrefix) return parsed.pathname.startsWith(pattern.pathPrefix);
    if (pattern.pathExact) return pattern.pathExact.includes(parsed.pathname);
    return parsed.pathname === '/';
  }

  function isLandingPage(url, landingPagePatterns) {
    return landingPagePatterns.some(pattern => matchesPattern(pattern, url));
  }

  function matchCustomGroup(url, customGroups) {
    const parsed = parseUrl(url);
    if (!parsed) return null;

    return customGroups.find(rule => {
      const hostMatch = rule.hostname
        ? parsed.hostname === rule.hostname
        : rule.hostnameEndsWith
          ? parsed.hostname.endsWith(rule.hostnameEndsWith)
          : false;

      if (!hostMatch) return false;
      if (rule.pathPrefix) return parsed.pathname.startsWith(rule.pathPrefix);
      if (rule.pathExact) return rule.pathExact.includes(parsed.pathname);
      return true;
    }) || null;
  }

  function normalizeTab(tab, extensionUrl) {
    return {
      id: tab.id,
      url: tab.url || tab.pendingUrl || '',
      title: tab.title || tab.url || 'Untitled',
      windowId: tab.windowId,
      active: !!tab.active,
      index: typeof tab.index === 'number' ? tab.index : 0,
      pinned: !!tab.pinned,
      discarded: !!tab.discarded,
      audible: !!tab.audible,
      groupId: typeof tab.groupId === 'number' ? tab.groupId : TAB_GROUP_NONE,
      favIconUrl: tab.favIconUrl || '',
      isTabOut: !!extensionUrl && tab.url === extensionUrl,
    };
  }

  function makeEmptyGroup(seed) {
    return {
      id: seed.id,
      type: seed.type,
      kind: seed.kind || seed.type,
      label: seed.label,
      tabs: [],
      sites: [],
      windowId: seed.windowId,
      firefoxGroupId: seed.firefoxGroupId,
      color: seed.color || '',
      collapsed: !!seed.collapsed,
      order: seed.order ?? 99,
    };
  }

  function addTabToGroup(map, seed, tab) {
    if (!map.has(seed.id)) {
      map.set(seed.id, makeEmptyGroup(seed));
    }
    map.get(seed.id).tabs.push(tab);
  }

  function getDuplicateInfo(tabs) {
    const urlCounts = {};
    for (const tab of tabs) {
      const key = normalizeUrlKey(tab.url);
      if (!key) continue;
      urlCounts[key] = (urlCounts[key] || 0) + 1;
    }

    const duplicateUrls = Object.entries(urlCounts).filter(([, count]) => count > 1);
    return {
      urlCounts,
      duplicateUrls: duplicateUrls.map(([url]) => url),
      duplicateExtras: duplicateUrls.reduce((sum, [, count]) => sum + count - 1, 0),
    };
  }

  function finalizeGroup(group) {
    group.tabs.sort((a, b) =>
      (a.windowId - b.windowId) ||
      (a.index - b.index) ||
      ((a.id || 0) - (b.id || 0))
    );
    group.sites = Array.from(new Set(group.tabs.map(tab => siteFromUrl(tab.url))))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    group.firstIndex = group.tabs.length ? group.tabs[0].index : 0;
    group.tabCount = group.tabs.length;
    group.duplicates = getDuplicateInfo(group.tabs);
    return group;
  }

  function groupTabs(rawTabs, firefoxGroups, options) {
    const opts = options || {};
    const extensionUrl = opts.extensionUrl || '';
    const landingPagePatterns = [
      ...DEFAULT_LANDING_PAGE_PATTERNS,
      ...(opts.landingPagePatterns || []),
    ];
    const customGroups = opts.customGroups || [];

    const tabs = rawTabs
      .map(tab => normalizeTab(tab, extensionUrl))
      .filter(tab => isUserFacingTabUrl(tab.url));

    const firefoxGroupsById = new Map();
    for (const group of firefoxGroups || []) {
      firefoxGroupsById.set(String(group.id), group);
    }

    const groups = new Map();

    for (const tab of tabs) {
      if (tab.groupId !== TAB_GROUP_NONE) {
        const nativeGroup = firefoxGroupsById.get(String(tab.groupId)) || {};
        addTabToGroup(groups, {
          id: `firefox:${tab.windowId}:${tab.groupId}`,
          type: 'firefox',
          kind: 'firefox',
          label: nativeGroup.title || `Firefox group ${tab.groupId}`,
          windowId: tab.windowId,
          firefoxGroupId: tab.groupId,
          color: nativeGroup.color || '',
          collapsed: !!nativeGroup.collapsed,
          order: 0,
        }, tab);
        continue;
      }

      if (isLandingPage(tab.url, landingPagePatterns)) {
        addTabToGroup(groups, {
          id: 'smart:homepages',
          type: 'smart',
          kind: 'homepages',
          label: 'Homepages',
          windowId: tab.windowId,
          order: 1,
        }, tab);
        continue;
      }

      const customRule = matchCustomGroup(tab.url, customGroups);
      if (customRule) {
        addTabToGroup(groups, {
          id: `smart:custom:${customRule.groupKey}`,
          type: 'smart',
          kind: 'custom',
          label: customRule.groupLabel || customRule.groupKey,
          windowId: tab.windowId,
          order: 2,
        }, tab);
        continue;
      }

      if (isLocalDevUrl(tab.url)) {
        addTabToGroup(groups, {
          id: 'smart:local-dev',
          type: 'smart',
          kind: 'local-dev',
          label: 'Local/dev',
          windowId: tab.windowId,
          order: 3,
        }, tab);
        continue;
      }

      const hostname = hostnameFromUrl(tab.url);
      if (hostname === 'local-files') {
        addTabToGroup(groups, {
          id: 'smart:local-files',
          type: 'smart',
          kind: 'local-files',
          label: 'Local files',
          windowId: tab.windowId,
          order: 4,
        }, tab);
        continue;
      }

      addTabToGroup(groups, {
        id: `smart:domain:${hostname}`,
        type: 'smart',
        kind: 'domain',
        label: friendlyDomain(hostname),
        windowId: tab.windowId,
        order: 5,
      }, tab);
    }

    return Array.from(groups.values())
      .map(finalizeGroup)
      .sort((a, b) =>
        (a.order - b.order) ||
        (a.type === 'firefox' && b.type === 'firefox'
          ? (a.windowId - b.windowId) || (a.firstIndex - b.firstIndex)
          : (b.tabCount - a.tabCount) || a.label.localeCompare(b.label))
      );
  }

  return {
    TAB_GROUP_NONE,
    DEFAULT_LANDING_PAGE_PATTERNS,
    friendlyDomain,
    getDuplicateInfo,
    groupTabs,
    hostnameFromUrl,
    isLandingPage,
    isLocalDevUrl,
    isUserFacingTabUrl,
    normalizeTab,
    normalizeUrlKey,
    siteFromUrl,
  };
});
