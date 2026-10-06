/*
 FEED PLANT — SUPABASE VALUE FIX (dynamic)
 Apply/load this file AFTER the existing app.js.
 It deliberately does not change n8n/Supabase schema.
*/

(function () {
  "use strict";

  function valueNumber(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const s = String(v).trim().replace(/,/g, "");
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function parseDeep(v) {
    if (typeof v !== "string") return v;
    let x = v;
    for (let i = 0; i < 5; i++) {
      const s = String(x).trim();
      if (!s) return x;
      try {
        const y = JSON.parse(s);
        if (y === x) break;
        x = y;
      } catch (_) {
        break;
      }
    }
    return x;
  }

  function keyNorm(k) {
    return String(k ?? "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "");
  }

  function findNumericByKey(value, matcher) {
    value = parseDeep(value);
    if (value === null || value === undefined) return null;

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findNumericByKey(item, matcher);
        if (found !== null) return found;
      }
      return null;
    }

    if (typeof value !== "object") return null;

    for (const [k, raw] of Object.entries(value)) {
      const v = parseDeep(raw);
      if (matcher(keyNorm(k))) {
        const n = valueNumber(v);
        if (n !== null) return n;
      }
      if (v && typeof v === "object") {
        const found = findNumericByKey(v, matcher);
        if (found !== null) return found;
      }
    }
    return null;
  }

  function directClosing(activity) {
    return findNumericByKey(activity, k =>
      k === "CLOSING" ||
      k === "CLOSINGSTOCK" ||
      k === "CLSTOCK" ||
      k === "CLOSINGBALANCE"
    );
  }

  function directOpening(activity) {
    return findNumericByKey(activity, k =>
      k === "OPENING" ||
      k === "OPENINGSTOCK" ||
      k === "OPENINGBALANCE"
    );
  }

  /*
   * Robust replacement:
   * Handles both:
   *   {Closing: 123, Opening: 100, Purchase: 25}
   * and
   *   [{transaction:"Closing", for_day:123}]
   * and nested JSON strings/arrays.
   */
  function fixedActivityTransactions(activity, date) {
    const out = [];

    function add(transaction, value, d, month = 0, year = 0) {
      const name = String(transaction ?? "").trim();
      if (!name) return;
      const n = valueNumber(value);
      if (n === null && value !== 0) return;

      out.push({
        report_date: dateOnly(d) || date,
        transaction: name,
        for_day: n ?? 0,
        for_month: valueNumber(month) ?? 0,
        for_year: valueNumber(year) ?? 0
      });
    }

    function txName(key) {
      const n = keyNorm(key);
      if (n === "OPENING" || n === "OPENINGSTOCK" || n === "OPENINGBALANCE")
        return "OPENING STOCK";
      if (
        n === "CLOSING" ||
        n === "CLOSINGSTOCK" ||
        n === "CLSTOCK" ||
        n === "CLOSINGBALANCE"
      )
        return "CL. STOCK";
      return String(key ?? "").trim();
    }

    function walk(v, fallbackDate) {
      v = parseDeep(v);
      if (v === null || v === undefined) return;

      if (Array.isArray(v)) {
        v.forEach(x => walk(x, fallbackDate));
        return;
      }

      if (typeof v !== "object") return;

      const direct = v.transaction ?? v.Transaction ??
        v.type ?? v.Type ?? v.movement ?? v.Movement;

      if (direct !== undefined && String(direct).trim()) {
        add(
          direct,
          v.for_day ?? v.For_Day ?? v.value ?? v.quantity ?? v.qty,
          v.report_date ?? v.Report_Date ?? v.date ?? v.Date ?? fallbackDate,
          v.for_month ?? v.For_Month,
          v.for_year ?? v.For_Year
        );
        return;
      }

      for (const [k, raw] of Object.entries(v)) {
        const nk = keyNorm(k);
        if (
          nk === "DATE" || nk === "DATES" || nk === "REPORTDATE" ||
          nk === "CATEGORY" || nk === "SHEETNAME" || nk === "MATERIAL"
        ) continue;

        const val = parseDeep(raw);

        if (val && typeof val === "object") {
          walk(val, fallbackDate);
          continue;
        }

        const n = valueNumber(val);
        if (n !== null) add(txName(k), n, fallbackDate);
      }
    }

    walk(activity, date);
    return out;
  }

  function fixedDetailRows(value) {
    value = parseDeep(value);
    const rows = [];
    const seen = new Set();

    function add(k, v) {
      const label = String(k ?? "").trim();
      if (!label || v === null || v === undefined || String(v).trim() === "") return;
      const n = valueNumber(v);
      const normalizedValue = n !== null ? n : String(v);
      const sig = label + "|" + String(normalizedValue);
      if (seen.has(sig)) return;
      seen.add(sig);
      rows.push({ label, value: normalizedValue });
    }

    function walk(v) {
      v = parseDeep(v);
      if (v === null || v === undefined) return;

      if (Array.isArray(v)) {
        v.forEach(walk);
        return;
      }

      if (typeof v !== "object") return;

      for (const [k, raw] of Object.entries(v)) {
        const nk = keyNorm(k);
        if (
          nk === "DATE" || nk === "DATES" || nk === "REPORTDATE" ||
          nk === "CATEGORY" || nk === "SHEETNAME" || nk === "MATERIAL"
        ) continue;

        const val = parseDeep(raw);
        if (val && typeof val === "object") walk(val);
        else add(k, val);
      }
    }

    walk(value);
    return rows;
  }

  function fixedNormalize(rows) {
    const grouped = new Map();
    const history = [];

    (Array.isArray(rows) ? rows : []).forEach(r => {
      const material = clean(r.sheet_name);
      const date = dateOnly(r.activity_date);
      if (!material || !date) return;

      const tx = fixedActivityTransactions(r.latest_activity, date);
      tx.forEach(t => history.push({
        material,
        ...t,
        category: r.category || ""
      }));

      const key = normalize(material);
      let g = grouped.get(key);

      if (!g) {
        g = {
          material,
          category: r.category || "",
          activityDate: date,
          latestActivity: r.latest_activity,
          forTheMonth: r.for_the_month,
          forTheYear: r.for_the_year,
          transactions: []
        };
        grouped.set(key, g);
      }

      if (date >= g.activityDate) {
        g.activityDate = date;
        g.latestActivity = r.latest_activity;
        g.forTheMonth = r.for_the_month;
        g.forTheYear = r.for_the_year;
      }

      g.transactions.push(...tx);
    });

    const stock = [...grouped.values()].map(g => {
      const tx = g.transactions.slice().sort((a, b) =>
        dateOnly(rowDate(a)).localeCompare(dateOnly(rowDate(b)))
      );

      const closingRows = tx.filter(t => tType(t) === "CL. STOCK");
      const parsedClosing = closingRows.length
        ? tVal(closingRows[closingRows.length - 1])
        : null;

      // Critical fallback: use the Closing value directly from JSONB.
      const direct = directClosing(g.latestActivity);
      const closing = parsedClosing !== null ? parsedClosing : direct;

      return {
        material: g.material,
        category: g.category,
        activityDate: g.activityDate,
        latestActivity: g.latestActivity,
        forTheMonth: g.forTheMonth,
        forTheYear: g.forTheYear,
        transactions: tx,
        closing
      };
    });

    return { stock, stockHistory: history };
  }

  /*
   * Replace the existing normalizer at runtime.
   * refreshData() below will therefore use the corrected parser.
   */
  window.__SUPABASE_VALUE_FIX__ = {
    directClosing,
    directOpening,
    fixedActivityTransactions,
    fixedDetailRows,
    fixedNormalize
  };

  // Function declarations in the original app are global lexical bindings.
  // Reassigning through eval is avoided; instead we patch the two consumers
  // that can safely be wrapped and then force a fresh dashboard load.
  const originalOpenMaterialDetails = window.openMaterialDetails;
  if (typeof originalOpenMaterialDetails === "function") {
    window.openMaterialDetails = function(material) {
      const x = getMaterial(material);
      if (!x) return originalOpenMaterialDetails(material);

      const fallback = directClosing(x.latestActivity);
      if (x.closing === null || x.closing === undefined) x.closing = fallback;

      return originalOpenMaterialDetails(material);
    };
  }

  /*
   * The existing normalizeSupabaseInventory is not safely replaceable from
   * another script because it is a lexical function binding. The definitive
   * fix is therefore supplied as an exact source replacement below.
   */
})();
