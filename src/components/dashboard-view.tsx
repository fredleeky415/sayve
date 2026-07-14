"use client";

import {
  Baby,
  BarChart3,
  HeartPulse,
  Home,
  Lightbulb,
  Repeat2,
  Settings2,
  ShoppingCart,
  Tag,
  Train,
  Utensils,
  WalletCards,
  type LucideIcon
} from "lucide-react";
import { type CSSProperties, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { storedAuthHeaders } from "./auth-client";

type ApiResult = {
  data?: unknown;
};

type Dashboard = {
  month: string;
  availableMonths: string[];
  income: number;
  expenses: number;
  net: number;
  memoryCount: number;
  factCount: number;
  contextCount: number;
  byCategory: Array<{ category: string; amount: number; count: number; percent: number; barPercent: number }>;
  daily: Array<{ date: string; income: number; expense: number; net: number; count: number }>;
  categoryOptions: string[];
  reviewQueue: Array<{
    memoryObjectId: string;
    title: string;
    status: string;
    currentState: string;
    confidence: number;
    intent: string;
    originalDump: string;
    fact?: {
      date: string;
      merchant: string;
      category: string;
      amount: number;
      direction: string;
    };
    reason: string;
  }>;
  monthlyFacts: Array<{
    id: string;
    date: string;
    title: string;
    category: string;
    amount: number;
    direction: "expense" | "income" | "transfer" | "unknown";
    note?: string;
    ownershipScope?: "shared" | "member";
    assignedMember?: string;
    createdBy?: string;
  }>;
  monthlyTrend: Array<{
    month: string;
    expense: number;
    income: number;
    net: number;
    count: number;
    expenseBarPercent: number;
    incomeBarPercent: number;
    selected: boolean;
  }>;
  categoryTrends: Array<{
    category: string;
    rows: Dashboard["monthlyTrend"];
  }>;
};

async function postJson(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...storedAuthHeaders() },
    body: JSON.stringify(body)
  });
  return (await response.json()) as ApiResult;
}

async function getDashboard(month: string) {
  const response = await fetch(`/api/views/dashboard?month=${encodeURIComponent(month)}`, { headers: storedAuthHeaders() });
  const result = (await response.json()) as ApiResult;
  return result.data as Dashboard;
}

function money(value: number | undefined) {
  return `HK$${(value ?? 0).toLocaleString("en-HK", { maximumFractionDigits: 1 })}`;
}

function shortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function dayNumber(value: string) {
  const day = Number(value.split("-")[2]);
  return Number.isFinite(day) ? day : value;
}

function currentMonthKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string) {
  const [year, monthNumber] = month.split("-");
  return `${year}年${Number(monthNumber)}月`;
}

function shortMonthLabel(month: string) {
  const monthIndex = Number(month.split("-")[1]) - 1;
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return labels[monthIndex] ?? month;
}

function groupMonthlyFacts(facts: Dashboard["monthlyFacts"]) {
  return facts.reduce<Array<{ date: string; facts: Dashboard["monthlyFacts"] }>>((groups, fact) => {
    const current = groups.find((group) => group.date === fact.date);
    if (current) current.facts.push(fact);
    else groups.push({ date: fact.date, facts: [fact] });
    return groups;
  }, []);
}

export function looksLikeUuid(value: string | undefined) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

export function readableMemberLabel(value: string | undefined) {
  if (!value) return "";
  if (value === "actor") return "自己";
  if (value === "partner") return "另一位成員";
  if (looksLikeUuid(value)) return "";
  return value;
}

export function ownershipLabel(fact: Dashboard["monthlyFacts"][number]) {
  if ((fact.ownershipScope ?? "shared") === "shared") return "公家";
  if (fact.assignedMember === "actor") return "自己";

  const assignedMember = readableMemberLabel(fact.assignedMember);
  if (assignedMember) return `${assignedMember} 自己`;

  const createdBy = readableMemberLabel(fact.createdBy);
  if (createdBy) return `${createdBy} 自己`;

  return "個人";
}

function calendarCells(month: string, days: Dashboard["daily"]) {
  const [yearRaw, monthRaw] = month.split("-");
  const year = Number(yearRaw);
  const monthNumber = Number(monthRaw);
  const firstDay = new Date(year, monthNumber - 1, 1).getDay();
  const mondayOffset = Number.isFinite(firstDay) ? (firstDay + 6) % 7 : 0;
  return [
    ...Array.from({ length: mondayOffset }, (_item, index) => ({ type: "empty" as const, id: `empty-${index}` })),
    ...days.map((day) => ({ type: "day" as const, id: day.date, day }))
  ];
}

function categoryIconFor(category: string): LucideIcon {
  const lower = category.toLowerCase();
  if (lower.includes("dining") || lower.includes("食") || lower.includes("飯")) return Utensils;
  if (lower.includes("grocer") || lower.includes("百佳") || lower.includes("買餸")) return ShoppingCart;
  if (lower.includes("housing") || lower.includes("home") || lower.includes("屋") || lower.includes("租")) return Home;
  if (lower.includes("transport") || lower.includes("mtr") || lower.includes("車")) return Train;
  if (lower.includes("utilities") || lower.includes("電") || lower.includes("水")) return Lightbulb;
  if (lower.includes("baby") || lower.includes("bb")) return Baby;
  if (lower.includes("health") || lower.includes("insurance") || lower.includes("醫")) return HeartPulse;
  if (lower.includes("subscription") || lower.includes("netflix") || lower.includes("每月")) return Repeat2;
  if (lower.includes("living") || lower.includes("income") || lower.includes("收入")) return WalletCards;
  return Tag;
}

const categoryPalette = ["#f97362", "#f9cc55", "#4fd1c5", "#8fb3ff", "#c8facc", "#f0abfc", "#fb7185", "#a78bfa", "#d1d5db"];

function categoryColorFor(category: string): string {
  const lower = category.toLowerCase();
  if (lower.includes("dining") || lower.includes("食") || lower.includes("飯")) return "#f97362";
  if (lower.includes("grocer") || lower.includes("百佳") || lower.includes("買餸")) return "#f9cc55";
  if (lower.includes("housing") || lower.includes("home") || lower.includes("屋") || lower.includes("租")) return "#8fb3ff";
  if (lower.includes("transport") || lower.includes("mtr") || lower.includes("車")) return "#4fd1c5";
  if (lower.includes("utilities") || lower.includes("電") || lower.includes("水")) return "#c8facc";
  if (lower.includes("baby") || lower.includes("bb")) return "#f0abfc";
  if (lower.includes("health") || lower.includes("insurance") || lower.includes("醫")) return "#fb7185";
  if (lower.includes("subscription") || lower.includes("netflix") || lower.includes("每月")) return "#a78bfa";
  if (lower.includes("living") || lower.includes("income") || lower.includes("收入")) return "#d1d5db";

  const hash = Array.from(category).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return categoryPalette[hash % categoryPalette.length];
}

function linePoint(
  row: Dashboard["monthlyTrend"][number],
  index: number,
  rows: Dashboard["monthlyTrend"],
  minValue: number,
  maxValue: number,
  key: "expense" | "income" | "net"
) {
  const x = rows.length <= 1 ? 0 : (index / (rows.length - 1)) * 100;
  const range = Math.max(1, maxValue - minValue);
  const y = 92 - ((row[key] - minValue) / range) * 78;
  return { x, y };
}

function linePoints(rows: Dashboard["monthlyTrend"], minValue: number, maxValue: number, key: "expense" | "income" | "net") {
  return rows.map((row, index) => {
    const point = linePoint(row, index, rows, minValue, maxValue, key);
    return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }).join(" ");
}

function zeroLineY(minValue: number, maxValue: number) {
  const range = Math.max(1, maxValue - minValue);
  return 92 - ((0 - minValue) / range) * 78;
}

function categoryDonutGradient(rows: Dashboard["byCategory"]) {
  if (rows.length === 0) return "rgba(255, 255, 255, 0.12) 0 100%";
  let cursor = 0;
  return rows
    .map((row, index) => {
      const start = cursor;
      cursor = index === rows.length - 1 ? 100 : Math.min(100, cursor + row.percent);
      return `${categoryColorFor(row.category)} ${start}% ${cursor}%`;
    })
    .join(", ");
}

export function DashboardView() {
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey());
  const [trendCategory, setTrendCategory] = useState("all");
  const [plView, setPlView] = useState<"summary" | "split">("summary");
  const [newCategory, setNewCategory] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState(false);
  const plSwipeStartRef = useRef<{ x: number; y: number } | null>(null);

  const refreshDashboard = useCallback(async () => {
    setDashboard(await getDashboard(selectedMonth));
  }, [selectedMonth]);

  useEffect(() => {
    void refreshDashboard();
  }, [refreshDashboard]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleMemoryChanged = () => {
      void refreshDashboard();
    };

    window.addEventListener("sayve:memory-changed", handleMemoryChanged);
    return () => window.removeEventListener("sayve:memory-changed", handleMemoryChanged);
  }, [refreshDashboard]);

  async function addCategory(event: FormEvent) {
    event.preventDefault();
    const name = newCategory.trim();
    if (!name) return;
    setBusy(true);
    await postJson("/api/categories", { name });
    setNewCategory("");
    await refreshDashboard();
    setBusy(false);
  }

  async function correctReviewItem(memoryObjectId: string, action: "confirm" | "category", value?: string) {
    setBusy(true);
    await postJson("/api/memory/correct", {
      memoryObjectId,
      action,
      value,
      correction: action === "category" ? `分類改為 ${value}` : "確認 AI 理解"
    });
    await refreshDashboard();
    setBusy(false);
  }

  function handlePlPointerUp(clientX: number, clientY: number) {
    if (!plSwipeStartRef.current) return;
    const deltaX = clientX - plSwipeStartRef.current.x;
    const deltaY = clientY - plSwipeStartRef.current.y;
    plSwipeStartRef.current = null;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaY) > Math.abs(deltaX) * 0.8) return;
    setPlView(deltaX < 0 ? "split" : "summary");
  }

  const monthlyGroups = groupMonthlyFacts(dashboard?.monthlyFacts ?? []);
  const availableMonths = dashboard?.availableMonths ?? [selectedMonth];
  const selectedMonthIndex = availableMonths.indexOf(selectedMonth);
  const newerMonth = selectedMonthIndex > 0 ? availableMonths[selectedMonthIndex - 1] : undefined;
  const olderMonth =
    selectedMonthIndex >= 0 && selectedMonthIndex < availableMonths.length - 1 ? availableMonths[selectedMonthIndex + 1] : undefined;
  const dailyCalendar = calendarCells(dashboard?.month ?? selectedMonth, dashboard?.daily ?? []);
  const weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];
  const selectedCategoryTrend = dashboard?.categoryTrends.find((trend) => trend.category === trendCategory);
  const trendRows = trendCategory === "all" ? dashboard?.monthlyTrend ?? [] : selectedCategoryTrend?.rows ?? dashboard?.monthlyTrend ?? [];
  const trendValues = trendRows.flatMap((row) => [row.expense, row.income, row.net]);
  const trendMinValue = Math.min(0, ...trendValues);
  const trendMaxValue = Math.max(1, ...trendValues);
  const expenseLinePoints = linePoints(trendRows, trendMinValue, trendMaxValue, "expense");
  const incomeLinePoints = linePoints(trendRows, trendMinValue, trendMaxValue, "income");
  const netLinePoints = linePoints(trendRows, trendMinValue, trendMaxValue, "net");
  const zeroY = zeroLineY(trendMinValue, trendMaxValue);
  const selectedTrendIndex = Math.max(0, trendRows.findIndex((row) => row.selected));
  const selectedGuideLeft = trendRows.length <= 1 ? 0 : (selectedTrendIndex / (trendRows.length - 1)) * 100;
  const expenses = dashboard?.expenses ?? 0;
  const categoryRows = dashboard?.byCategory ?? [];
  const categoryGradient = categoryDonutGradient(categoryRows);

  return (
    <section className="dashboardView">
      <div className="dashboardHeader">
        <div>
          <p>總覽</p>
          <h1>{monthLabel(dashboard?.month ?? selectedMonth)}</h1>
        </div>
        <div className="monthControls" aria-label="月份">
          <button type="button" onClick={() => olderMonth && setSelectedMonth(olderMonth)} disabled={!olderMonth}>
            上月
          </button>
          <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} aria-label="選擇月份">
            {availableMonths.map((month) => (
              <option key={month} value={month}>
                {monthLabel(month)}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => newerMonth && setSelectedMonth(newerMonth)} disabled={!newerMonth}>
            下月
          </button>
          <BarChart3 size={22} />
        </div>
      </div>

      <div
        className="plPanel"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          plSwipeStartRef.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => handlePlPointerUp(event.clientX, event.clientY)}
        onPointerCancel={() => {
          plSwipeStartRef.current = null;
        }}
      >
        <div className={plView === "summary" ? "plSlide active" : "plSlide"} aria-hidden={plView !== "summary"}>
          <div className="plRow">
            <span>收入</span>
            <strong>{money(dashboard?.income)}</strong>
          </div>
          <div className="plRow">
            <span>支出</span>
            <strong>{money(dashboard?.expenses)}</strong>
          </div>
          <div className="plDivider" />
          <div className="plRow total">
            <span>損益</span>
            <strong>{money(dashboard?.net)}</strong>
          </div>
        </div>
        <div className={plView === "split" ? "plSlide active" : "plSlide"} aria-hidden={plView !== "split"}>
          <div className="plSplit">
            <div
              className="plDonut"
              style={
                {
                  "--category-slices": categoryGradient
                } as CSSProperties
              }
              aria-label="支出分類比例"
            >
              <span>{money(expenses)}</span>
            </div>
            <div className="plSplitRows">
              {categoryRows.length === 0 ? (
                <div className="plSplitEmpty">未有分類資料</div>
              ) : (
                categoryRows.slice(0, 5).map((row) => (
                  <div className="plSplitRow category" style={{ "--category-color": categoryColorFor(row.category) } as CSSProperties} key={row.category}>
                    <span>{row.category}</span>
                    <strong>{money(row.amount)}</strong>
                    <small>{row.percent}%</small>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        <div className="plPager" aria-label="收入支出檢視">
          <button
            type="button"
            className={plView === "summary" ? "active" : ""}
            onClick={() => setPlView("summary")}
            aria-label="收入支出"
          />
          <button
            type="button"
            className={plView === "split" ? "active" : ""}
            onClick={() => setPlView("split")}
            aria-label="比例"
          />
        </div>
      </div>

      <div className="metricGrid">
        <Metric label="已記低" value={dashboard?.memoryCount ?? 0} />
        <Metric label="已整理" value={dashboard?.factCount ?? 0} />
        <Metric label="家庭狀態" value={dashboard?.contextCount ?? 0} />
        <Metric label="每日平均支出" value={money((dashboard?.expenses ?? 0) / Math.max(1, dashboard?.daily.length ?? 0))} />
      </div>

      {(dashboard?.reviewQueue ?? []).length > 0 && (
        <section className="dashboardPanel reviewInbox">
          <div className="panelTitle">
            <div>
              <span>Sayve 不太肯定</span>
              <h2>待你確認</h2>
            </div>
            <strong>{dashboard?.reviewQueue.length}</strong>
          </div>
          <div className="reviewList">
            {dashboard?.reviewQueue.map((item) => (
              <article className="reviewItem" key={item.memoryObjectId}>
                <div className="reviewMain">
                  <strong>{item.title}</strong>
                  <span>{item.originalDump || item.reason}</span>
                  <div className="reviewMeta">
                    <span>信心 {Math.round(item.confidence * 100)}%</span>
                    {item.fact && <span>{item.fact.category || "未分類"} · {money(item.fact.amount)}</span>}
                  </div>
                </div>
                <div className="reviewActions">
                  <button type="button" onClick={() => correctReviewItem(item.memoryObjectId, "confirm")} disabled={busy}>
                    確認
                  </button>
                  {(dashboard?.categoryOptions ?? []).slice(0, 5).map((category) => (
                    <button
                      type="button"
                      className="ghost"
                      key={category}
                      onClick={() => correctReviewItem(item.memoryObjectId, "category", category)}
                      disabled={busy}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="dashboardPanel trendPanel">
          <div className="panelTitle">
            <div>
              <span>一年走勢</span>
              <h2>每月開支 / 收入</h2>
            </div>
          <div className="trendLegend">
            <select value={trendCategory} onChange={(event) => setTrendCategory(event.target.value)} aria-label="選擇趨勢分類">
              <option value="all">全部分類</option>
              {(dashboard?.categoryTrends ?? []).map((trend) => (
                <option key={trend.category} value={trend.category}>
                  {trend.category}
                </option>
              ))}
            </select>
            <span className="expense">開支</span>
            <span className="income">收入</span>
            <span className="net">損益</span>
          </div>
        </div>
        <div className="trendLineChart">
          <div className="trendPlot">
            <span className="trendSelectedGuide" style={{ left: `${selectedGuideLeft}%` }} />
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="每月開支及收入線圖">
              <line className="trendGridLine" x1="0" x2="100" y1="14" y2="14" />
              <line className="trendGridLine" x1="0" x2="100" y1="53" y2="53" />
              <line className="trendGridLine" x1="0" x2="100" y1="92" y2="92" />
              <line className="trendZeroLine" x1="0" x2="100" y1={zeroY} y2={zeroY} />
              <polyline className="trendLine expense" points={expenseLinePoints} />
              <polyline className="trendLine income" points={incomeLinePoints} />
              <polyline className="trendLine net" points={netLinePoints} />
            </svg>
            {trendRows.map((row, index) => {
              const expensePoint = linePoint(row, index, trendRows, trendMinValue, trendMaxValue, "expense");
              const incomePoint = linePoint(row, index, trendRows, trendMinValue, trendMaxValue, "income");
              const netPoint = linePoint(row, index, trendRows, trendMinValue, trendMaxValue, "net");
              return (
                <div key={row.month}>
                  <span
                    className={row.selected ? "trendDot expense selected" : "trendDot expense"}
                    style={{ left: `${expensePoint.x}%`, top: `${expensePoint.y}%` }}
                    title={`${monthLabel(row.month)} 開支 ${money(row.expense)}`}
                  />
                  <span
                    className={row.selected ? "trendDot income selected" : "trendDot income"}
                    style={{ left: `${incomePoint.x}%`, top: `${incomePoint.y}%` }}
                    title={`${monthLabel(row.month)} 收入 ${money(row.income)}`}
                  />
                  <span
                    className={row.selected ? "trendDot net selected" : "trendDot net"}
                    style={{ left: `${netPoint.x}%`, top: `${netPoint.y}%` }}
                    title={`${monthLabel(row.month)} 損益 ${money(row.net)}`}
                  />
                </div>
              );
            })}
          </div>
          <div className="trendXAxis">
            {trendRows.map((row) => (
              <span className={row.selected ? "selected" : ""} key={row.month} title={`${monthLabel(row.month)} 開支 ${money(row.expense)} / 收入 ${money(row.income)}`}>
                {shortMonthLabel(row.month)}
              </span>
            ))}
          </div>
        </div>
      </section>

      <div className="dashboardGrid">
        <section className="dashboardPanel categoryBreakdown">
          <div className="panelTitle">
            <div>
              <span>今個月</span>
              <h2>本月分類</h2>
            </div>
            <Settings2 size={18} />
          </div>
          {(dashboard?.byCategory ?? []).length === 0 ? (
            <p className="emptyState">未有分類資料。回到記低，跟 Sayve 說一聲就可以了。</p>
          ) : (
            dashboard?.byCategory.map((row) => (
              <div key={row.category} className="categorySpendRow">
                <div className="categorySpendMeta">
                  <span>{row.category}</span>
                  <strong>{money(row.amount)}</strong>
                </div>
                <div className="categorySpendSub">
                  <span>{row.count} 件</span>
                  <span>{row.percent}%</span>
                </div>
                <div className="categoryBar">
                  <i style={{ width: `${row.barPercent}%` }} />
                </div>
              </div>
            ))
          )}
        </section>

        <section className="dashboardPanel dailyPanel">
          <div className="panelTitle">
            <div>
              <span>每日</span>
              <h2>每日開支</h2>
            </div>
          </div>
          {(dashboard?.daily ?? []).length === 0 ? (
            <p className="emptyState">未有每日資料。</p>
          ) : (
            <div className="calendarGrid">
              {weekdayLabels.map((label) => (
                <span className="calendarWeekday" key={label}>
                  {label}
                </span>
              ))}
              {dailyCalendar.map((cell) =>
                cell.type === "empty" ? (
                  <span className="calendarCell empty" key={cell.id} />
                ) : (
                  <div className={cell.day.count > 0 ? "calendarCell active" : "calendarCell"} key={cell.id}>
                    <span>{dayNumber(cell.day.date)}</span>
                    <strong>{cell.day.expense > 0 ? `-${money(cell.day.expense)}` : cell.day.income > 0 ? money(cell.day.income) : ""}</strong>
                  </div>
                )
              )}
            </div>
          )}
        </section>

        <section className="dashboardPanel categoriesPanel">
          <div className="panelTitle">
            <div>
              <span>分類設定</span>
              <h2>自定義開支種類</h2>
            </div>
          </div>
          <form className="categoryForm" onSubmit={addCategory}>
            <input aria-label="新增自定義分類" value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="例如：BB 學費" />
            <button type="submit" disabled={busy || !newCategory.trim()}>
              加入
            </button>
          </form>
          <div className="categoryChips">
            {(dashboard?.categoryOptions ?? []).map((category) => (
              <CategoryChip category={category} key={category} />
            ))}
          </div>
        </section>

        <section className="dashboardPanel monthListPanel">
          <div className="panelTitle">
            <div>
              <span>全月</span>
              <h2>本月記錄</h2>
            </div>
          </div>
          {monthlyGroups.length === 0 ? (
            <p className="emptyState">未有記憶。</p>
          ) : (
            monthlyGroups.map((group) => (
              <div className="monthListGroup" key={group.date}>
                <div className="monthListDate">
                  <strong>{shortDate(group.date)}</strong>
                  <span>
                    {group.facts.length} 件 ·{" "}
                    {money(group.facts.reduce((sum, fact) => sum + (fact.direction === "income" ? fact.amount : -fact.amount), 0))}
                  </span>
                </div>
                {group.facts.map((fact) => (
                  <div className="recentFactRow" key={fact.id}>
                    <div>
                      <strong>{fact.title}</strong>
                      <span className="recentFactMeta">
                        <span>{fact.category}</span>
                        <small>{ownershipLabel(fact)}</small>
                      </span>
                    </div>
                    <b>{fact.direction === "income" ? money(fact.amount) : `-${money(fact.amount)}`}</b>
                  </div>
                ))}
              </div>
            ))
          )}
        </section>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="metricCard">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function CategoryChip({ category }: { category: string }) {
  const Icon = categoryIconFor(category);
  return (
    <button type="button" className="categoryChip" style={{ "--category-color": categoryColorFor(category) } as CSSProperties}>
      <Icon size={15} strokeWidth={1.9} />
      <span>{category}</span>
    </button>
  );
}
