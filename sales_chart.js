// Beat sales chart for sellers: paid sales and free downloads over time (by week or month),
// plus best-selling beats ranked. Uses the seller's real data from /api/marketplace/sales
// (paidSales) and /api/marketplace/freeEmail/leads. Pure helpers are exported for tests.
(function(W){
  'use strict';
  const D = W.document;
  const EARNING = ['paid', 'partially_refunded'];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const money = (cents, cur) => { try{ return new Intl.NumberFormat('en-US', { style:'currency', currency:cur || 'USD' }).format((cents || 0) / 100); }catch(_){ return `$${((cents || 0) / 100).toFixed(2)}`; } };

  // Start of the bucket holding `date` (UTC). Weeks start on Monday.
  function bucketStart(date, period){
    const d = new Date(date);
    if(period === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const dow = (d.getUTCDay() + 6) % 7;
    return day - dow * 86400000;
  }
  function stepBack(start, period, n){
    if(period === 'month'){ const d = new Date(start); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1); }
    return start - n * 7 * 86400000;
  }
  function bucketLabel(start, period){
    const d = new Date(start);
    const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
    return period === 'month' ? `${mon} ${String(d.getUTCFullYear()).slice(2)}` : `${mon} ${d.getUTCDate()}`;
  }
  // Paid sales: prefer the slim paidSales list (all paid rows); fall back to the order list.
  function paidSalesFrom(sales){
    if(!sales) return [];
    if(Array.isArray(sales.paidSales)) return sales.paidSales;
    return (sales.orders || []).filter(o => EARNING.includes(o.paymentStatus)).map(o => ({ listingId:o.listingId, paidAt:o.paidAt || o.createdAt, sellerAmountCents:o.sellerAmountCents, currency:o.currency }));
  }
  function buildSalesSeries({ sales, leads, listings, period = 'week', now = Date.now(), buckets } = {}){
    period = period === 'month' ? 'month' : 'week';
    const count = buckets || (period === 'month' ? 6 : 8);
    const last = bucketStart(now, period);
    const series = [];
    for(let i = count - 1; i >= 0; i--){ const start = stepBack(last, period, i); series.push({ start, label:bucketLabel(start, period), sales:0, earningsCents:0, downloads:0 }); }
    const find = t => { const b = bucketStart(t, period); return series.find(x => x.start === b); };
    const paid = paidSalesFrom(sales);
    const byListing = new Map();
    const row = id => { const key = String(id || 'unknown'); if(!byListing.has(key)) byListing.set(key, { listingId:key, sales:0, earningsCents:0, downloads:0 }); return byListing.get(key); };
    let currency = 'USD';
    paid.forEach(p => {
      const t = Date.parse(p.paidAt); if(p.currency) currency = p.currency;
      const r = row(p.listingId); r.sales += 1; r.earningsCents += Number(p.sellerAmountCents || 0);
      const b = Number.isFinite(t) && find(t); if(b){ b.sales += 1; b.earningsCents += Number(p.sellerAmountCents || 0); }
    });
    (leads || []).forEach(l => {
      const t = Date.parse(l.downloadedAt || l.claimedAt || l.createdAt);
      row(l.listingId).downloads += 1;
      const b = Number.isFinite(t) && find(t); if(b) b.downloads += 1;
    });
    const titles = new Map((listings || []).map(l => [String(l.id || l.listingId), l.title || l.name]));
    const best = [...byListing.values()].filter(r => r.sales || r.downloads)
      .map(r => ({ ...r, title:titles.get(r.listingId) || 'A beat you removed' }))
      .sort((a, b) => b.sales - a.sales || b.earningsCents - a.earningsCents || b.downloads - a.downloads || a.title.localeCompare(b.title))
      .slice(0, 5);
    const totals = series.reduce((t, b) => ({ sales:t.sales + b.sales, earningsCents:t.earningsCents + b.earningsCents, downloads:t.downloads + b.downloads }), { sales:0, earningsCents:0, downloads:0 });
    const empty = !paid.length && !(leads || []).length;
    return { period, series, best, totals, currency, empty };
  }

  function chartHtml(data){
    const max = Math.max(1, ...data.series.map(b => Math.max(b.sales, b.downloads)));
    const bars = data.series.map(b => `<div class="sales-chart-col" title="${esc(b.label)}: ${b.sales} sold, ${b.downloads} free downloads"><div class="sales-chart-bars"><i class="bar-sales" style="height:${Math.round(b.sales / max * 100)}%"></i><i class="bar-free" style="height:${Math.round(b.downloads / max * 100)}%"></i></div><span>${esc(b.label)}</span></div>`).join('');
    return `<div class="sales-chart" role="img" aria-label="Sales and free downloads by ${data.period}">${bars}</div><div class="sales-chart-key"><span><i class="bar-sales"></i>Sold</span><span><i class="bar-free"></i>Free downloads</span></div>`;
  }
  function insightsHtml(data, period, sample){
    const toggle = `<div class="sales-period" role="group" aria-label="Group by"><button type="button" class="ghost small${period === 'week' ? ' active' : ''}" data-sales-period="week" aria-pressed="${period === 'week'}">By week</button><button type="button" class="ghost small${period === 'month' ? ' active' : ''}" data-sales-period="month" aria-pressed="${period === 'month'}">By month</button></div>`;
    const head = `<div class="sales-insights-head"><h4>Sales over time${sample ? ' <span class="sample-tag">Sample data</span>' : ''}</h4>${toggle}</div>`;
    if(data.empty) return `${head}<div class="sales-empty" data-sales-empty><strong>No sales or downloads yet</strong><p class="muted">When someone buys a beat or grabs a free one, it shows up here by ${period}.</p></div>`;
    const sums = `<div class="store-earnings sales-sums"><div><b>${data.totals.sales}</b><span>sold</span></div><div><b>${esc(money(data.totals.earningsCents, data.currency))}</b><span>earned</span></div><div><b>${data.totals.downloads}</b><span>free downloads</span></div></div>`;
    const best = data.best.length ? `<h4>Best-selling beats</h4><ol class="sales-best">${data.best.map(r => `<li><strong>${esc(r.title)}</strong><span>${r.sales} sold · ${esc(money(r.earningsCents, data.currency))} · ${r.downloads} free</span></li>`).join('')}</ol>` : '';
    return `${head}${sums}${chartHtml(data)}<p class="muted small">Showing the last ${data.series.length} ${period}s.</p>${best}`;
  }

  const view = { period:'week', leads:null, leadsStatus:'idle', sample:null };
  async function loadLeads(){
    const api = W.DJBattleApi;
    if(!api || !api.apiRequest || view.leadsStatus === 'loading') return;
    view.leadsStatus = 'loading';
    try{
      const res = await api.apiRequest('/api/marketplace/freeEmail/leads?limit=500');
      const data = res && (res.data || res);
      view.leads = (data && data.leads) || [];
      view.leadsStatus = res && res.error ? 'failed' : 'ready';
    }catch(_){ view.leads = []; view.leadsStatus = 'failed'; }
    render();
  }
  function render(){
    const box = D.getElementById('store-insights');
    if(!box) return;
    const seller = W.djbBeatStoreSeller ? W.djbBeatStoreSeller() : null;
    const mine = W.djbBeatStoreMine ? W.djbBeatStoreMine() : [];
    if(!view.sample && !mine.length && !(seller && seller.sales && (seller.sales.paidSales || seller.sales.orders || []).length)){ box.innerHTML = ''; return; }
    if(!view.sample && view.leadsStatus === 'idle'){ box.innerHTML = '<p class="muted">Loading your sales chart…</p>'; loadLeads(); return; }
    const src = view.sample || { sales:seller && seller.sales, leads:view.leads, listings:mine };
    const data = buildSalesSeries({ ...src, period:view.period, now:src.now || Date.now() });
    box.innerHTML = insightsHtml(data, view.period, Boolean(view.sample));
    box.querySelectorAll('[data-sales-period]').forEach(btn => { btn.onclick = () => { view.period = btn.getAttribute('data-sales-period'); render(); }; });
  }
  function refresh(){ view.leadsStatus = 'idle'; view.leads = null; render(); }

  W.DJBSalesChart = { buildSalesSeries, bucketStart, insightsHtml, render, refresh, _view:view };
})(window);
