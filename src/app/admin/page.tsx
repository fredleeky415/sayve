import { buildDeploymentSmokeCommands, canAccessFounderConsole, founderTokenRequired, getFounderConsoleData } from "@/server/admin/founder-console";
import { ADMIN_COOKIE } from "@/server/admin/http";
import { getLaunchReadinessReport } from "@/server/admin/launch-readiness";
import { AdminHouseholdTools } from "@/components/admin-household-tools";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import type React from "react";

type AdminPageProps = {
  searchParams: Promise<{ token?: string }>;
};

function formatUsd(value: number) {
  return `$${value.toFixed(4)}`;
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="adminKpi">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Panel({
  title,
  children,
  className
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`adminPanel ${className ?? ""}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function MetricRows({ rows }: { rows: Array<[string, string | number]> }) {
  return (
    <div className="adminRows">
      {rows.map(([label, value]) => (
        <div className="adminRow" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function LaunchBlockers({
  rows
}: {
  rows: Awaited<ReturnType<typeof getFounderConsoleData>>["readableViews"]["launchBlockers"];
}) {
  const criticalCount = rows.filter((row) => row.level === "critical").length;
  const warningCount = rows.filter((row) => row.level === "warn").length;

  return (
    <div className="adminDeployGuide">
      <div className="adminKpiGrid">
        <Kpi label="Critical Blockers" value={criticalCount} />
        <Kpi label="Warnings" value={warningCount} />
      </div>

      {rows.length === 0 ? (
        <div className="adminDeployBlock">
          <h3>Launch Status</h3>
          <p>目前冇明顯 blocker，可以進入真實 beta 驗證。</p>
        </div>
      ) : (
        <div className="adminRows">
          {rows.slice(0, 8).map((row) => (
            <div className="adminRow" key={`${row.level}-${row.area}-${row.blocker}`}>
              <span>{`${String(row.level).toUpperCase()} · ${row.blocker}`}</span>
              <strong>{`${row.detail} ${row.action ? `Next: ${row.action}` : ""}`.trim()}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PublicLaunchChecks({
  rows
}: {
  rows: Awaited<ReturnType<typeof getFounderConsoleData>>["readableViews"]["publicLaunchChecks"];
}) {
  return (
    <div className="adminDeployGuide">
      {rows.length === 0 ? (
        <div className="adminDeployBlock">
          <h3>Public Launch Checks</h3>
          <p>目前所有 public-launch checks 都已 pass。</p>
        </div>
      ) : (
        <div className="adminRows">
          {rows.map((row) => (
            <div className="adminRow" key={`${row.id}-${row.line}`}>
              <span>{`${String(row.status).toUpperCase()} · ${row.label}`}</span>
              <strong>{String(row.detail)}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LiveProofGaps({
  rows
}: {
  rows: Awaited<ReturnType<typeof getFounderConsoleData>>["readableViews"]["liveProofGaps"];
}) {
  const provenCount = rows.filter((row) => row.status === "proven").length;
  const pendingCount = rows.filter((row) => row.status !== "proven").length;

  return (
    <div className="adminDeployGuide">
      <div className="adminKpiGrid">
        <Kpi label="Live Proof Done" value={provenCount} />
        <Kpi label="Still Pending" value={pendingCount} />
      </div>

      <div className="adminRows">
        {rows.map((row) => (
          <div className="adminRow" key={`${row.area}-${row.proofType}`}>
            <span>{`${String(row.status).toUpperCase()} · ${row.area}`}</span>
            <strong>{`${row.detail} ${row.nextAction ? `Next: ${row.nextAction}` : ""}`.trim()}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function OnboardingProofSteps({
  rows
}: {
  rows: Awaited<ReturnType<typeof getFounderConsoleData>>["readableViews"]["onboardingProofSteps"];
}) {
  return (
    <div className="adminDeployGuide">
      <div className="adminRows">
        {rows.map((row) => (
          <div className="adminRow" key={`${row.step}-${row.item}`}>
            <span>{`${row.step}. ${row.item} · ${String(row.status).toUpperCase()}`}</span>
            <strong>{`${row.proof} ${row.nextAction ? `Next: ${row.nextAction}` : ""}`.trim()}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniList({ title, rows }: { title: string; rows: Array<{ label: string; count: number; percent?: number }> }) {
  return (
    <div className="adminMiniList">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p>No telemetry yet.</p>
      ) : (
        rows.map((row) => (
          <div className="adminListRow" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.percent === undefined ? row.count : `${row.count} / ${row.percent}%`}</strong>
          </div>
        ))
      )}
    </div>
  );
}

function RawTable({ rows }: { rows: Array<Record<string, string | number>> }) {
  if (rows.length === 0) return <p className="adminEmpty">No rows yet.</p>;
  const columns = Object.keys(rows[0]);

  return (
    <div className="adminRawTableWrap">
      <table className="adminRawTable">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column}>{row[column]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExportLinks({
  name,
  scope = "raw"
}: {
  name: string;
  scope?: "raw" | "view";
}) {
  const csvHref = `/api/admin/export?scope=${scope}&name=${name}&format=csv`;
  const jsonHref = `/api/admin/export?scope=${scope}&name=${name}&format=json`;
  return (
    <div className="adminExportLinks">
      <a className="adminExportLink" href={csvHref}>
        CSV
      </a>
      <a className="adminExportLink" href={jsonHref}>
        JSON
      </a>
    </div>
  );
}

function envState(value?: string) {
  return value?.trim() ? "SET" : "MISSING";
}

function adminCodeBlock(text: string) {
  return <pre className="adminCodeBlock">{text}</pre>;
}

function BuildProgress({
  defaultHouseholdBinding,
  launchReadiness,
  telemetryEvents
}: {
  defaultHouseholdBinding: Awaited<ReturnType<typeof getFounderConsoleData>>["defaultHouseholdBinding"];
  launchReadiness: Awaited<ReturnType<typeof getLaunchReadinessReport>>;
  telemetryEvents: number;
}) {
  const privateBetaSteps = [
    { label: "Default household bound", done: defaultHouseholdBinding.exists },
    { label: "Owner present", done: defaultHouseholdBinding.ownerCount > 0 },
    { label: "Second member added", done: defaultHouseholdBinding.memberCount >= 2 },
    { label: "AI telemetry seen", done: telemetryEvents > 0 },
    { label: "Private beta config ready", done: launchReadiness.configReadyForPrivateBeta },
    { label: "Live smoke verified", done: launchReadiness.liveSmokeVerified }
  ];

  const publicLaunchSteps = [
    ...privateBetaSteps,
    { label: "Public launch gate passed", done: launchReadiness.readyForPublicLaunch }
  ];

  const calcPercent = (steps: Array<{ done: boolean }>) => Math.round((steps.filter((step) => step.done).length / steps.length) * 100);
  const privateBetaPercent = calcPercent(privateBetaSteps);
  const publicLaunchPercent = calcPercent(publicLaunchSteps);

  const privateBetaNext =
    !defaultHouseholdBinding.exists
      ? "先綁定真實 household。"
      : defaultHouseholdBinding.ownerCount === 0
        ? "補返 owner member。"
        : defaultHouseholdBinding.memberCount < 2
          ? "邀請另一位家庭成員。"
          : telemetryEvents === 0
            ? "做一次真 capture 或 ask，令 telemetry 開始有數。"
            : !launchReadiness.configReadyForPrivateBeta
              ? "解決 Launch Readiness failures。"
              : !launchReadiness.liveSmokeVerified
                ? "跑一次 verify:deploy:private-beta。"
                : "Private beta 已可進入真實試用。";

  const publicLaunchNext = launchReadiness.readyForPublicLaunch
    ? "Public launch gate 已全部通過。"
    : launchReadiness.liveSmokeVerified
      ? "補齊 public launch blockers，再重新 smoke。"
      : "先完成 live deployment smoke。";

  return (
    <div className="adminDeployGuide">
      <div className="adminKpiGrid">
        <Kpi label="Private Beta Progress" value={`${privateBetaPercent}%`} />
        <Kpi label="Public Launch Progress" value={`${publicLaunchPercent}%`} />
      </div>

      <div className="adminDeployBlock">
        <h3>Next For Private Beta</h3>
        <p>{privateBetaNext}</p>
      </div>

      <div className="adminDeployBlock">
        <h3>Next For Public Launch</h3>
        <p>{publicLaunchNext}</p>
      </div>

      <MiniList
        title="Private Beta Checklist"
        rows={privateBetaSteps.map((step) => ({
          label: step.label,
          count: step.done ? 1 : 0
        }))}
      />

      <MiniList
        title="Public Launch Checklist"
        rows={publicLaunchSteps.map((step) => ({
          label: step.label,
          count: step.done ? 1 : 0
        }))}
      />
    </div>
  );
}

function SetupGuide({
  defaultHouseholdBinding,
  launchReadiness
}: {
  defaultHouseholdBinding: Awaited<ReturnType<typeof getFounderConsoleData>>["defaultHouseholdBinding"];
  launchReadiness: Awaited<ReturnType<typeof getLaunchReadinessReport>>;
}) {
  const steps = [
    {
      label: "Default household",
      status: defaultHouseholdBinding.exists ? "READY" : "FIX",
      detail: defaultHouseholdBinding.exists
        ? `Bound to ${defaultHouseholdBinding.householdId}.`
        : defaultHouseholdBinding.issue || "Set and verify SUPABASE_DEFAULT_HOUSEHOLD_ID."
    },
    {
      label: "Founder owner",
      status: defaultHouseholdBinding.ownerCount > 0 ? "READY" : "FIX",
      detail:
        defaultHouseholdBinding.ownerCount > 0
          ? `${defaultHouseholdBinding.ownerCount} owner found.`
          : "Create or attach at least one owner member to the household."
    },
    {
      label: "Partner setup",
      status: defaultHouseholdBinding.memberCount >= 2 ? "READY" : "NEXT",
      detail:
        defaultHouseholdBinding.memberCount >= 2
          ? `${defaultHouseholdBinding.memberCount} household members are present.`
          : "Invite your partner or add the second member before real shared-memory testing."
    },
    {
      label: "Live smoke",
      status: launchReadiness.liveSmokeVerified ? "READY" : "NEXT",
      detail: launchReadiness.liveSmokeVerified
        ? "Deployment smoke has been verified."
        : "Run verify:deploy:private-beta on the real deployment."
    },
    {
      label: "Public launch gate",
      status: launchReadiness.readyForPublicLaunch ? "READY" : launchReadiness.configReadyForPrivateBeta ? "PENDING" : "BLOCKED",
      detail: launchReadiness.readyForPublicLaunch
        ? "All current public launch gates pass."
        : launchReadiness.configReadyForPrivateBeta
          ? "Private beta config is ready, but live proof is still incomplete."
          : "Resolve launch readiness failures before moving beyond local/private setup."
    }
  ];

  return (
    <div className="adminList">
      {steps.map((step) => (
        <div className="adminListRow" key={step.label}>
          <span>
            {step.label}
            <small className="adminStepDetail">{step.detail}</small>
          </span>
          <strong>{step.status}</strong>
        </div>
      ))}
    </div>
  );
}

function PrivateBetaHandoff({
  defaultHouseholdBinding,
  launchReadiness,
  telemetryEvents
}: {
  defaultHouseholdBinding: Awaited<ReturnType<typeof getFounderConsoleData>>["defaultHouseholdBinding"];
  launchReadiness: Awaited<ReturnType<typeof getLaunchReadinessReport>>;
  telemetryEvents: number;
}) {
  const steps = [
    {
      label: "Default household bound",
      done: defaultHouseholdBinding.exists
    },
    {
      label: "Owner present",
      done: defaultHouseholdBinding.ownerCount > 0
    },
    {
      label: "Partner added",
      done: defaultHouseholdBinding.memberCount >= 2
    },
    {
      label: "AI telemetry seen",
      done: telemetryEvents > 0
    },
    {
      label: "Private beta config ready",
      done: launchReadiness.configReadyForPrivateBeta
    },
    {
      label: "Live smoke verified",
      done: launchReadiness.liveSmokeVerified
    }
  ];

  const completed = steps.filter((step) => step.done).length;
  const total = steps.length;
  const percent = Math.round((completed / total) * 100);
  const status = launchReadiness.liveSmokeVerified
    ? "READY"
    : launchReadiness.configReadyForPrivateBeta
      ? "IN PROGRESS"
      : "BLOCKED";

  const nextAction =
    !defaultHouseholdBinding.exists
      ? "Fix the default household binding first."
      : defaultHouseholdBinding.ownerCount === 0
        ? "Add or confirm at least one owner."
        : defaultHouseholdBinding.memberCount < 2
          ? "Invite your partner into the same household."
          : telemetryEvents === 0
            ? "Create one real capture or ask one real question to prove telemetry."
            : !launchReadiness.configReadyForPrivateBeta
              ? "Resolve Launch Readiness failures until private beta config is ready."
              : !launchReadiness.liveSmokeVerified
                ? "Run verify:deploy:private-beta on the live deployment."
                : "Private beta handoff is ready.";

  return (
    <div className="adminHandoff">
      <div className="adminHandoffTop">
        <strong>{status}</strong>
        <span>
          {completed}/{total} complete
        </span>
      </div>
      <div className="adminHandoffBar" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="adminHandoffText">{nextAction}</p>
      <div className="adminHandoffSteps">
        {steps.map((step) => (
          <div className="adminHandoffStep" key={step.label}>
            <span>{step.label}</span>
            <strong>{step.done ? "DONE" : "OPEN"}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeploymentSmokeGuide({
  launchReadiness,
  defaultHouseholdBinding
}: {
  launchReadiness: Awaited<ReturnType<typeof getLaunchReadinessReport>>;
  defaultHouseholdBinding: Awaited<ReturnType<typeof getFounderConsoleData>>["defaultHouseholdBinding"];
}) {
  const deployUrl = process.env.SAYVE_DEPLOY_URL?.trim() || "";
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
  const appAccessToken = process.env.APP_ACCESS_TOKEN?.trim() || "";
  const adminConsoleToken = process.env.ADMIN_CONSOLE_TOKEN?.trim() || "";
  const founderToken = process.env.SAYVE_TEST_SUPABASE_ACCESS_TOKEN?.trim() || "";
  const partnerToken = process.env.SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN?.trim() || "";
  const viewerToken = process.env.SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN?.trim() || "";
  const inviteAcceptToken = process.env.SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN?.trim() || "";
  const householdId = process.env.SAYVE_TEST_HOUSEHOLD_ID?.trim() || defaultHouseholdBinding.householdId || "";
  const commands = buildDeploymentSmokeCommands(defaultHouseholdBinding.householdId);
  const privateBetaCommand = commands.privateBeta;
  const publicLaunchCommand = commands.publicLaunch;

  return (
    <div className="adminDeployGuide">
      <MetricRows
        rows={[
          ["Deploy URL", `${envState(deployUrl)}${deployUrl ? ` · ${deployUrl}` : ""}`],
          ["App Base URL", `${envState(appBaseUrl)}${appBaseUrl ? ` · ${appBaseUrl}` : ""}`],
          ["App Gate Token", envState(appAccessToken)],
          ["Admin Token", envState(adminConsoleToken)],
          ["Owner Session Token", envState(founderToken)],
          ["Partner Session Token", envState(partnerToken)],
          ["Viewer Session Token", envState(viewerToken)],
          ["Invite Accept Token", envState(inviteAcceptToken)],
          ["Smoke Household ID", `${envState(householdId)}${householdId ? ` · ${householdId}` : ""}`]
        ]}
      />

      <div className="adminDeployBlock">
        <h3>Private Beta</h3>
        <p>用呢個 command 做真 deployment smoke。未有 partner 或 viewer token 都可以先跑。</p>
        {adminCodeBlock(privateBetaCommand)}
      </div>

      <div className="adminDeployBlock">
        <h3>Public Launch</h3>
        <p>呢個會驗 owner / member / viewer 三個角色；如果有 fresh token，亦可以順手驗 invite acceptance 真 join household。</p>
        {adminCodeBlock(publicLaunchCommand)}
      </div>

      <div className="adminDeployChecklist">
        <div className="adminHandoffStep">
          <span>Private beta config</span>
          <strong>{launchReadiness.configReadyForPrivateBeta ? "READY" : "OPEN"}</strong>
        </div>
        <div className="adminHandoffStep">
          <span>Live smoke verified</span>
          <strong>{launchReadiness.liveSmokeVerified ? "READY" : "OPEN"}</strong>
        </div>
        <div className="adminHandoffStep">
          <span>Public launch gate</span>
          <strong>{launchReadiness.readyForPublicLaunch ? "READY" : "OPEN"}</strong>
        </div>
      </div>
    </div>
  );
}

function DeployProofPack({
  launchReadiness,
  defaultHouseholdBinding
}: {
  launchReadiness: Awaited<ReturnType<typeof getLaunchReadinessReport>>;
  defaultHouseholdBinding: Awaited<ReturnType<typeof getFounderConsoleData>>["defaultHouseholdBinding"];
}) {
  const commands = buildDeploymentSmokeCommands(defaultHouseholdBinding.householdId);
  const strictProofCommand = commands.strictPrivateBetaProof;
  const reportPath = "outputs/setup/deploy-proof-report.json";
  const summaryPath = "outputs/setup/deploy-proof-summary.md";
  const nextMove = !launchReadiness.configReadyForPrivateBeta
    ? "先解決 Launch Readiness fail-level blockers，再跑 proof。"
    : !launchReadiness.liveSmokeVerified
      ? "而家最值得做係跑 strict private beta proof，順手收集 live smoke 證據。"
      : launchReadiness.readyForPublicLaunch
        ? "live proof 已經齊，可以保存 report + summary 作 rollout evidence。"
        : "private beta smoke 已證明，但 public launch proof 仲未齊，補完後再跑 public-ready smoke。";

  return (
    <div className="adminDeployGuide">
      <div className="adminKpiGrid">
        <Kpi label="Proof Report" value={reportPath} />
        <Kpi label="Readable Summary" value={summaryPath} />
      </div>

      <div className="adminDeployBlock">
        <h3>Run Strict Private Beta Proof</h3>
        <p>呢條係 founder 最常用嗰條 proof command。跑完會自動寫 JSON report 同可讀 summary。</p>
        {adminCodeBlock(strictProofCommand)}
      </div>

      <div className="adminDeployBlock">
        <h3>Regenerate Summary Only</h3>
        <p>如果 report 已經存在，但你只想再整理一次 founder summary，用呢條就得。</p>
        {adminCodeBlock("pnpm run report:deploy-proof")}
      </div>

      <div className="adminDeployChecklist">
        <div className="adminHandoffStep">
          <span>Private beta config</span>
          <strong>{launchReadiness.configReadyForPrivateBeta ? "READY" : "OPEN"}</strong>
        </div>
        <div className="adminHandoffStep">
          <span>Live smoke proof</span>
          <strong>{launchReadiness.liveSmokeVerified ? "READY" : "OPEN"}</strong>
        </div>
        <div className="adminHandoffStep">
          <span>Public launch proof</span>
          <strong>{launchReadiness.readyForPublicLaunch ? "READY" : "OPEN"}</strong>
        </div>
      </div>

      <div className="adminDeployBlock">
        <h3>What To Do Next</h3>
        <p>{nextMove}</p>
      </div>
    </div>
  );
}

function OnboardingProofStatus({
  defaultHouseholdBinding,
  onboardingHealth
}: {
  defaultHouseholdBinding: Awaited<ReturnType<typeof getFounderConsoleData>>["defaultHouseholdBinding"];
  onboardingHealth: Awaited<ReturnType<typeof getFounderConsoleData>>["onboardingHealth"];
}) {
  const partnerReady = defaultHouseholdBinding.memberCount >= 2;
  const viewerTokenReady = Boolean(process.env.SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN?.trim());
  const inviteAcceptTokenReady = Boolean(process.env.SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN?.trim());
  const bootstrapTokenReady = Boolean(process.env.SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN?.trim());
  const partnerStatus = partnerReady ? "READY" : onboardingHealth.pendingInvites > 0 ? "PENDING" : "OPEN";
  const nextMove = partnerReady
    ? !viewerTokenReady
      ? "partner proof 已有，下一步補 viewer token 做 read-only smoke。"
      : !bootstrapTokenReady
        ? "role proof 差唔多齊，下一步準備 fresh zero-household bootstrap token。"
        : "onboarding proof inputs 已經幾齊，可以集中跑真 live smoke。"
    : onboardingHealth.pendingInvites > 0
      ? "partner invite 已出咗，等第二位家庭成員用另一個 Google account 接受。"
      : "先建立 partner invite，完成第二位家庭成員加入同一 household。";

  return (
    <div className="adminDeployGuide">
      <div className="adminKpiGrid">
        <Kpi label="Partner Join" value={partnerStatus} />
        <Kpi label="Viewer Token" value={viewerTokenReady ? "READY" : "OPEN"} />
        <Kpi label="Invite Accept Token" value={inviteAcceptTokenReady ? "READY" : "OPEN"} />
        <Kpi label="Bootstrap Token" value={bootstrapTokenReady ? "READY" : "OPEN"} />
      </div>

      <div className="adminRows">
        <div className="adminRow">
          <span>Partner Household Proof</span>
          <strong>
            {partnerReady
              ? `${defaultHouseholdBinding.memberCount} members already in the same household`
              : onboardingHealth.pendingInvites > 0
                ? `${onboardingHealth.pendingInvites} pending invite(s) waiting to be accepted`
                : "No partner join proof yet"}
          </strong>
        </div>
        <div className="adminRow">
          <span>Viewer Read-only Smoke</span>
          <strong>{viewerTokenReady ? "Viewer session token is prepared" : "Need a clean viewer account + token"}</strong>
        </div>
        <div className="adminRow">
          <span>Invite Acceptance Smoke</span>
          <strong>{inviteAcceptTokenReady ? "Fresh unjoined account token is prepared" : "Need a fresh unjoined account token"}</strong>
        </div>
        <div className="adminRow">
          <span>Bootstrap Smoke</span>
          <strong>{bootstrapTokenReady ? "Fresh zero-household token is prepared" : "Need a fresh zero-household token"}</strong>
        </div>
      </div>

      <div className="adminDeployBlock">
        <h3>Next Onboarding Move</h3>
        <p>{nextMove}</p>
      </div>
    </div>
  );
}

function LiveProofCoverage({
  launchReadiness,
  liveProofGaps
}: {
  launchReadiness: Awaited<ReturnType<typeof getLaunchReadinessReport>>;
  liveProofGaps: Awaited<ReturnType<typeof getFounderConsoleData>>["readableViews"]["liveProofGaps"];
}) {
  const total = liveProofGaps.length;
  const proven = liveProofGaps.filter((row) => row.status === "proven").length;
  const inProgress = liveProofGaps.filter((row) => row.status === "in_progress" || row.status === "ready_to_test").length;
  const open = total - proven - inProgress;
  const coverage = total === 0 ? 0 : Math.round((proven / total) * 100);
  const headline = launchReadiness.readyForPublicLaunch
    ? "Public launch proof 已達標。"
    : launchReadiness.liveSmokeVerified
      ? "Private beta live smoke 已證明，但 public launch proof 仲未收齊。"
      : "而家仍然主要卡喺 live proof，而唔係本地架構。";

  return (
    <div className="adminDeployGuide">
      <div className="adminKpiGrid">
        <Kpi label="Coverage" value={`${coverage}%`} />
        <Kpi label="Proven" value={proven} />
        <Kpi label="In Progress" value={inProgress} />
        <Kpi label="Open" value={open} />
      </div>

      <div className="adminDeployBlock">
        <h3>Launch Readout</h3>
        <p>{headline}</p>
      </div>

      <div className="adminRows">
        {liveProofGaps.map((row) => (
          <div className="adminRow" key={`${row.area}-${row.proofType}`}>
            <span>{`${String(row.status).toUpperCase()} · ${String(row.area)}`}</span>
            <strong>{String(row.nextAction ?? row.detail ?? "")}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function LiveRolloutChecklist({
  rows
}: {
  rows: Awaited<ReturnType<typeof getFounderConsoleData>>["readableViews"]["liveRollout"];
}) {
  return (
    <div className="adminList">
      {rows.map((step) => (
        <div className="adminListRow" key={String(step.item)}>
          <span>
            {step.item}
            <small className="adminStepDetail">{String(step.detail ?? "")}</small>
          </span>
          <strong>{String(step.status ?? "")}</strong>
        </div>
      ))}
    </div>
  );
}

function PrivateBetaSetupGate({
  rows
}: {
  rows: Awaited<ReturnType<typeof getFounderConsoleData>>["readableViews"]["privateBetaSetupGate"];
}) {
  return (
    <div className="adminList">
      {rows.map((row) => (
        <div className="adminListRow" key={`${String(row.step)}-${String(row.item)}`}>
          <span>
            {`${String(row.step)}. ${String(row.item)}`}
            <small className="adminStepDetail">{`${String(row.detail ?? "")} Source: ${String(row.source ?? "")}`}</small>
          </span>
          <strong>{String(row.status ?? "")}</strong>
        </div>
      ))}
    </div>
  );
}

function ExecutionChecklist({
  rows
}: {
  rows: Awaited<ReturnType<typeof getFounderConsoleData>>["readableViews"]["executionChecklist"];
}) {
  return (
    <div className="adminList">
      {rows.map((row) => (
        <div className="adminListRow" key={`${String(row.step)}-${String(row.item)}-execution`}>
          <span>
            {`${String(row.step)}. ${String(row.item)}`}
            <small className="adminStepDetail">{`${String(row.detail ?? "")} Owner: ${String(row.owner ?? "")} · Source: ${String(row.source ?? "")}`}</small>
          </span>
          <strong>{String(row.status ?? "")}</strong>
        </div>
      ))}
    </div>
  );
}

function IntegrationReadiness({
  rows
}: {
  rows: Awaited<ReturnType<typeof getFounderConsoleData>>["readableViews"]["integrationReadiness"];
}) {
  return (
    <div className="adminList">
      {rows.map((row) => (
        <div className="adminListRow" key={`${String(row.system)}-${String(row.stage)}`}>
          <span>
            {`${String(row.system)} · ${String(row.stage)}`}
            <small className="adminStepDetail">{`${String(row.detail ?? "")} Required: ${String(row.required ?? "")}`}</small>
          </span>
          <strong>{String(row.status ?? "")}</strong>
        </div>
      ))}
    </div>
  );
}

function IntegrationPackage({
  rows
}: {
  rows: Awaited<ReturnType<typeof getFounderConsoleData>>["readableViews"]["integrationPackage"];
}) {
  return (
    <div className="adminRawTableWrap">
      <table className="adminRawTable">
        <thead>
          <tr>
            <th>system</th>
            <th>field</th>
            <th>stage</th>
            <th>status</th>
            <th>value</th>
            <th>target</th>
            <th>detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${String(row.system)}-${String(row.field)}-${index}`}>
              <td>{String(row.system ?? "")}</td>
              <td>{String(row.field ?? "")}</td>
              <td>{String(row.stage ?? "")}</td>
              <td>{String(row.status ?? "")}</td>
              <td>{String(row.value ?? "")}</td>
              <td>{String(row.target ?? "")}</td>
              <td>{String(row.detail ?? "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProviderSetup({
  rows
}: {
  rows: Awaited<ReturnType<typeof getFounderConsoleData>>["readableViews"]["providerSetup"];
}) {
  return (
    <div className="adminRawTableWrap">
      <table className="adminRawTable">
        <thead>
          <tr>
            <th>provider</th>
            <th>section</th>
            <th>field</th>
            <th>status</th>
            <th>value</th>
            <th>target</th>
            <th>detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${String(row.provider)}-${String(row.field)}-${index}`}>
              <td>{String(row.provider ?? "")}</td>
              <td>{String(row.section ?? "")}</td>
              <td>{String(row.field ?? "")}</td>
              <td>{String(row.status ?? "")}</td>
              <td>{String(row.value ?? "")}</td>
              <td>{String(row.target ?? "")}</td>
              <td>{String(row.detail ?? "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuthSetupTargets({
  rows
}: {
  rows: Awaited<ReturnType<typeof getFounderConsoleData>>["readableViews"]["authSetup"];
}) {
  return (
    <div className="adminList">
      {rows.map((row) => (
        <div className="adminListRow" key={String(row.item)}>
          <span>
            {String(row.item)}
            <small className="adminStepDetail">{String(row.detail ?? "")}</small>
          </span>
          <strong>{String(row.target || row.value || row.status || "")}</strong>
        </div>
      ))}
    </div>
  );
}

function EnvSetupMatrix({
  rows
}: {
  rows: Awaited<ReturnType<typeof getFounderConsoleData>>["readableViews"]["envSetup"];
}) {
  return (
    <div className="adminRawTableWrap">
      <table className="adminRawTable">
        <thead>
          <tr>
            <th>group</th>
            <th>env</th>
            <th>requiredFor</th>
            <th>status</th>
            <th>value</th>
            <th>note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${String(row.env)}-${index}`}>
              <td>{String(row.group ?? "")}</td>
              <td>{String(row.env ?? "")}</td>
              <td>{String(row.requiredFor ?? "")}</td>
              <td>{String(row.status ?? "")}</td>
              <td>{String(row.value ?? "")}</td>
              <td>{String(row.note ?? "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SmokeTokenGuide({
  rows
}: {
  rows: Awaited<ReturnType<typeof getFounderConsoleData>>["readableViews"]["smokeTokenGuide"];
}) {
  return (
    <div className="adminRawTableWrap">
      <table className="adminRawTable">
        <thead>
          <tr>
            <th>role</th>
            <th>env</th>
            <th>where</th>
            <th>action</th>
            <th>extra</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${String(row.role)}-${index}`}>
              <td>{String(row.role ?? "")}</td>
              <td>{String(row.env ?? "")}</td>
              <td>{String(row.where ?? "")}</td>
              <td>{String(row.action ?? "")}</td>
              <td>{String(row.extra ?? "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EnvTemplateBlock({
  rows
}: {
  rows: Awaited<ReturnType<typeof getFounderConsoleData>>["readableViews"]["envTemplate"];
}) {
  const content = rows.map((row) => `${String(row.env)}=${String(row.value)}`).join("\n");

  return (
    <div className="adminDeployGuide">
      <p>直接抄去 Vercel / `.env`，再將 placeholder 換成真值。</p>
      {adminCodeBlock(content)}
    </div>
  );
}

function DeployEnvTemplateBlock({
  rows
}: {
  rows: Awaited<ReturnType<typeof getFounderConsoleData>>["readableViews"]["deployEnvTemplate"];
}) {
  const content = rows.map((row) => `${String(row.env)}=${String(row.value)}`).join("\n");

  return (
    <div className="adminDeployGuide">
      <p>呢份偏向真 deploy / public launch / smoke proof，唔係淨係 private beta。</p>
      {adminCodeBlock(content)}
    </div>
  );
}

function DeploySmokeEnvTemplateBlock({
  rows
}: {
  rows: Awaited<ReturnType<typeof getFounderConsoleData>>["readableViews"]["deploySmokeEnvTemplate"];
}) {
  const content = rows.map((row) => `${String(row.env)}=${String(row.value)}`).join("\n");

  return (
    <div className="adminDeployGuide">
      <p>呢份係 deploy 當日 smoke command 前面要帶住嘅 env flags，同 session token checklist 放埋同一頁。</p>
      {adminCodeBlock(content)}
    </div>
  );
}

function OAuthChecklist({
  rows
}: {
  rows: Awaited<ReturnType<typeof getFounderConsoleData>>["readableViews"]["oauthChecklist"];
}) {
  return (
    <div className="adminDeployGuide">
      {rows.map((row) => (
        <div className="adminDeployBlock" key={`${row.step}-${row.item}`}>
          <h3>
            Step {row.step}: {row.item}
          </h3>
          <p>{row.detail}</p>
          <p>
            <strong>Target:</strong> {row.target}
          </p>
        </div>
      ))}
    </div>
  );
}

function RepositorySmokeGuide({
  rows
}: {
  rows: Awaited<ReturnType<typeof getFounderConsoleData>>["readableViews"]["repositorySmokeGuide"];
}) {
  return (
    <div className="adminDeployGuide">
      {rows.map((row) => (
        <div className="adminDeployBlock" key={`${row.step}-${row.item}`}>
          <h3>
            Step {row.step}: {row.item}
          </h3>
          <p>{row.detail}</p>
          <p>
            <strong>Target:</strong> {row.target}
          </p>
        </div>
      ))}
    </div>
  );
}

export default async function FounderConsolePage({ searchParams }: AdminPageProps) {
  const params = await searchParams;
  const adminCookieToken = (await cookies()).get(ADMIN_COOKIE)?.value;
  const adminHeaderToken = (await headers()).get("x-admin-token");
  const accessToken = params.token ?? adminCookieToken ?? adminHeaderToken;
  if (!canAccessFounderConsole(accessToken)) notFound();

  const launchReadiness = await getLaunchReadinessReport();
  const data = await getFounderConsoleData({
    launchReadiness: {
      configReadyForPrivateBeta: launchReadiness.configReadyForPrivateBeta,
      liveSmokeVerified: launchReadiness.liveSmokeVerified,
      readyForPublicLaunch: launchReadiness.readyForPublicLaunch
    },
    launchReadinessChecks: launchReadiness.checks
  });

  return (
    <main className="adminShell">
      <header className="adminHeader">
        <div>
          <p>Internal Only</p>
          <h1>Founder Console</h1>
        </div>
        <div className="adminMeta">
          <span>{founderTokenRequired() ? "Token protected" : "Local prototype access"}</span>
          <time>{new Date(data.generatedAt).toLocaleString("zh-HK")}</time>
        </div>
      </header>

      <section className="adminKpiGrid" aria-label="Founder KPI">
        <Kpi label="Active Households" value={data.kpi.activeHouseholds} />
        <Kpi label="Memory Today" value={data.kpi.memoryCreatedToday} />
        <Kpi label="Auto Confirm" value={`${data.kpi.autoConfirmPercent}%`} />
        <Kpi label="Correction" value={`${data.kpi.userCorrectionPercent}%`} />
        <Kpi label="Cost / Household" value={formatUsd(data.kpi.averageCostPerHouseholdUsd)} />
        <Kpi label="Cost / Memory" value={formatUsd(data.kpi.averageCostPerMemoryUsd)} />
        <Kpi label="Merge Success" value={`${data.kpi.mergeSuccessPercent}%`} />
        <Kpi label="AI Health" value={data.kpi.aiHealthScore} />
      </section>

      <div className="adminGrid">
        <Panel title="Launch Readiness" className="wide">
          <MetricRows
            rows={[
              ["Overall", launchReadiness.status.toUpperCase()],
              ["Config Ready for Private Beta", launchReadiness.configReadyForPrivateBeta ? "YES" : "NO"],
              ["Live Smoke Verified", launchReadiness.liveSmokeVerified ? "YES" : "NO"],
              ["Ready for Public Launch", launchReadiness.readyForPublicLaunch ? "YES" : "NO"],
              ["Smoke Verified At", launchReadiness.smokeProof.verifiedAt || "n/a"],
              ["Smoke Target", launchReadiness.smokeProof.targetUrl || "n/a"],
              ["Supabase Schema Check", "/api/admin/import/supabase/schema-check"],
              ["Repository Smoke Test", "/api/admin/repository/smoke-test"],
              ...launchReadiness.checks.map((check) => [check.label, `${check.status.toUpperCase()} · ${check.detail}`] as [string, string])
            ]}
          />
        </Panel>

        <Panel title="Household Setup" className="wide">
          <AdminHouseholdTools />
        </Panel>

        <Panel title="Current Build Progress">
          <BuildProgress
            defaultHouseholdBinding={data.defaultHouseholdBinding}
            launchReadiness={launchReadiness}
            telemetryEvents={data.aiRuntimeHealth.totalAiEvents}
          />
        </Panel>

        <Panel title="Setup Guide">
          <SetupGuide defaultHouseholdBinding={data.defaultHouseholdBinding} launchReadiness={launchReadiness} />
        </Panel>

        <Panel title="Launch Completion Audit" className="wide">
          <RawTable rows={data.readableViews.launchCompletionAudit} />
          <ExportLinks name="launchCompletionAudit" scope="view" />
        </Panel>

        <Panel title="Launch Blockers" className="wide">
          <LaunchBlockers rows={data.readableViews.launchBlockers} />
          <ExportLinks name="launchBlockers" scope="view" />
        </Panel>

        <Panel title="Live Proof Gaps" className="wide">
          <LiveProofGaps rows={data.readableViews.liveProofGaps} />
          <ExportLinks name="liveProofGaps" scope="view" />
        </Panel>

        <Panel title="Live Proof Coverage" className="wide">
          <LiveProofCoverage launchReadiness={launchReadiness} liveProofGaps={data.readableViews.liveProofGaps} />
        </Panel>

        <Panel title="Live Smoke Evidence" className="wide">
          <RawTable rows={data.readableViews.liveSmokeEvidence} />
          <ExportLinks name="liveSmokeEvidence" scope="view" />
        </Panel>

        <Panel title="Public Launch Checks" className="wide">
          <PublicLaunchChecks rows={data.readableViews.publicLaunchChecks} />
          <ExportLinks name="publicLaunchChecks" scope="view" />
        </Panel>

        <Panel title="Live Rollout Checklist">
          <LiveRolloutChecklist rows={data.readableViews.liveRollout} />
        </Panel>

        <Panel title="Private Beta Setup Gate" className="wide">
          <PrivateBetaSetupGate rows={data.readableViews.privateBetaSetupGate} />
          <ExportLinks name="privateBetaSetupGate" scope="view" />
        </Panel>

        <Panel title="Execution Checklist" className="wide">
          <ExecutionChecklist rows={data.readableViews.executionChecklist} />
          <ExportLinks name="executionChecklist" scope="view" />
        </Panel>

        <Panel title="Onboarding Proof Steps" className="wide">
          <OnboardingProofSteps rows={data.readableViews.onboardingProofSteps} />
          <ExportLinks name="onboardingProofSteps" scope="view" />
        </Panel>

        <Panel title="Integration Readiness" className="wide">
          <IntegrationReadiness rows={data.readableViews.integrationReadiness} />
          <ExportLinks name="integrationReadiness" scope="view" />
        </Panel>

        <Panel title="Integration Package" className="wide">
          <IntegrationPackage rows={data.readableViews.integrationPackage} />
          <ExportLinks name="integrationPackage" scope="view" />
        </Panel>

        <Panel title="Provider Setup" className="wide">
          <ProviderSetup rows={data.readableViews.providerSetup} />
          <ExportLinks name="providerSetup" scope="view" />
        </Panel>

        <Panel title="Auth Setup Targets">
          <AuthSetupTargets rows={data.readableViews.authSetup} />
          <ExportLinks name="authSetup" scope="view" />
        </Panel>

        <Panel title="Env Setup Matrix" className="wide">
          <EnvSetupMatrix rows={data.readableViews.envSetup} />
          <ExportLinks name="envSetup" scope="view" />
        </Panel>

        <Panel title="Copy-Paste Env Template" className="wide">
          <EnvTemplateBlock rows={data.readableViews.envTemplate} />
          <ExportLinks name="envTemplate" scope="view" />
        </Panel>

        <Panel title="Deployment Env Template" className="wide">
          <DeployEnvTemplateBlock rows={data.readableViews.deployEnvTemplate} />
          <ExportLinks name="deployEnvTemplate" scope="view" />
        </Panel>

        <Panel title="Deploy Smoke Env Template" className="wide">
          <DeploySmokeEnvTemplateBlock rows={data.readableViews.deploySmokeEnvTemplate} />
          <ExportLinks name="deploySmokeEnvTemplate" scope="view" />
        </Panel>

        <Panel title="Repository Smoke Guide" className="wide">
          <RepositorySmokeGuide rows={data.readableViews.repositorySmokeGuide} />
          <ExportLinks name="repositorySmokeGuide" scope="view" />
        </Panel>

        <Panel title="Google OAuth Checklist" className="wide">
          <OAuthChecklist rows={data.readableViews.oauthChecklist} />
          <ExportLinks name="oauthChecklist" scope="view" />
        </Panel>

        <Panel title="Smoke Token Guide" className="wide">
          <SmokeTokenGuide rows={data.readableViews.smokeTokenGuide} />
          <ExportLinks name="smokeTokenGuide" scope="view" />
        </Panel>

        <Panel title="Private Beta Handoff">
          <PrivateBetaHandoff
            defaultHouseholdBinding={data.defaultHouseholdBinding}
            launchReadiness={launchReadiness}
            telemetryEvents={data.aiRuntimeHealth.totalAiEvents}
          />
        </Panel>

        <Panel title="Deploy Smoke Guide">
          <DeploymentSmokeGuide defaultHouseholdBinding={data.defaultHouseholdBinding} launchReadiness={launchReadiness} />
        </Panel>

        <Panel title="Deploy Proof Pack" className="wide">
          <DeployProofPack defaultHouseholdBinding={data.defaultHouseholdBinding} launchReadiness={launchReadiness} />
        </Panel>

        <Panel title="Default Household Binding">
          <MetricRows
            rows={[
              ["Configured", data.defaultHouseholdBinding.configured ? "YES" : "NO"],
              ["Household ID", data.defaultHouseholdBinding.householdId || "n/a"],
              ["Exists", data.defaultHouseholdBinding.exists ? "YES" : "NO"],
              ["Members", data.defaultHouseholdBinding.memberCount],
              ["Owners", data.defaultHouseholdBinding.ownerCount],
              ["Issue", data.defaultHouseholdBinding.issue || "none"]
            ]}
          />
        </Panel>

        <Panel title="Onboarding Health">
          <MetricRows
            rows={[
              ["Configured", data.onboardingHealth.configured ? "YES" : "NO"],
              ["Total Invites", data.onboardingHealth.totalInvites],
              ["Pending", data.onboardingHealth.pendingInvites],
              ["Accepted", data.onboardingHealth.acceptedInvites],
              ["Expired", data.onboardingHealth.expiredInvites],
              ["Email Locked", data.onboardingHealth.emailLockedInvites],
              ["Issue", data.onboardingHealth.issue || "none"]
            ]}
          />
          <MiniList
            title="Recent Invites"
            rows={data.onboardingHealth.recentInvites.map((invite) => ({
              label: `${invite.email || "no email"} · ${invite.role} · ${invite.status}`,
              count: 1
            }))}
          />
        </Panel>

        <Panel title="Onboarding Proof Status">
          <OnboardingProofStatus defaultHouseholdBinding={data.defaultHouseholdBinding} onboardingHealth={data.onboardingHealth} />
        </Panel>

        <Panel title="AI Cost Analytics">
          <MetricRows
            rows={[
              ["Today AI Cost", formatUsd(data.aiCostAnalytics.todayCostUsd)],
              ["Month AI Cost", formatUsd(data.aiCostAnalytics.monthCostUsd)],
              ["Cost / Household", formatUsd(data.aiCostAnalytics.averageCostPerHouseholdUsd)],
              ["Cost / Memory", formatUsd(data.aiCostAnalytics.averageCostPerMemoryUsd)],
              ["Token Usage", data.aiCostAnalytics.tokenUsage],
              ["Vision Calls", data.aiCostAnalytics.visionCalls],
              ["Speech Calls", data.aiCostAnalytics.speechCalls],
              ["Speech Duration", `${(data.aiCostAnalytics.speechDurationMs / 1000).toFixed(1)}s`]
            ]}
          />
        </Panel>

        <Panel title="AI Runtime Health">
          <MetricRows
            rows={[
              ["AI Events", data.aiRuntimeHealth.totalAiEvents],
              ["OpenAI Events", data.aiRuntimeHealth.openAiEvents],
              ["OpenAI Success", `${data.aiRuntimeHealth.openAiSuccessRate}%`],
              ["OpenAI Fallback", `${data.aiRuntimeHealth.openAiFallbackRate}%`],
              ["OpenAI Errors", data.aiRuntimeHealth.openAiErrorEvents],
              ["Fallback Rate", `${data.aiRuntimeHealth.fallbackRate}%`],
              ["Error Rate", `${data.aiRuntimeHealth.errorRate}%`],
              ["Limited Rate", `${data.aiRuntimeHealth.limitedRate}%`],
              ["Today Errors", data.aiRuntimeHealth.todayErrors],
              ["Avg Latency", `${data.aiRuntimeHealth.averageDurationMs}ms`],
              ["P95 Latency", `${data.aiRuntimeHealth.p95DurationMs}ms`],
              ["Slowest Phase", `${data.aiRuntimeHealth.slowestPhase} · ${data.aiRuntimeHealth.slowestPhaseAverageDurationMs}ms`],
              ["Telemetry Complete", `${data.aiRuntimeHealth.telemetryCompletenessPercent}%`],
              ["Budget Coverage", `${data.aiRuntimeHealth.budgetCoveragePercent}%`],
              ["Budget Overrun", data.aiRuntimeHealth.budgetOverrunEvents],
              ["Missing Tokens", data.aiRuntimeHealth.missingTokenEvents],
              ["Missing Cost", data.aiRuntimeHealth.missingCostEvents],
              ["Missing Latency", data.aiRuntimeHealth.missingDurationEvents]
            ]}
          />
        </Panel>

        <Panel title="AI Decisions">
          <MetricRows
            rows={[
              ["Capture Decisions", data.aiDecisionAnalytics.captureDecisionEvents],
              ["Auto Confirm", `${data.aiDecisionAnalytics.autoConfirmPercent}%`],
              ["Review Later", `${data.aiDecisionAnalytics.reviewLaterPercent}%`],
              ["Ask User", `${data.aiDecisionAnalytics.askUserPercent}%`],
              ["Low Confidence", `${data.aiDecisionAnalytics.lowConfidencePercent}%`]
            ]}
          />
          <MiniList title="Intent Mix" rows={data.aiDecisionAnalytics.intentMix} />
          <MiniList title="Decision Mix" rows={data.aiDecisionAnalytics.decisionMix} />
        </Panel>

        <Panel title="Memory Quality">
          <MetricRows
            rows={[
              ["Total Memories", data.memoryQuality.totalMemories],
              ["Auto Confirm", `${data.memoryQuality.autoConfirmPercent}%`],
              ["Review Later", `${data.memoryQuality.reviewLaterPercent}%`],
              ["Ask User", `${data.memoryQuality.askUserPercent}%`],
              ["Merge Success", `${data.memoryQuality.mergeSuccessRate}%`],
              ["Duplicate Detection", data.memoryQuality.duplicateDetectionCount],
              ["Average Confidence", data.memoryQuality.averageConfidence],
              ["Correction Rate", `${data.memoryQuality.userCorrectionRate}%`]
            ]}
          />
        </Panel>

        <Panel title="Usage Analytics">
          <MetricRows
            rows={[
              ["Text Capture", `${data.usageAnalytics.textCapturePercent}%`],
              ["Receipt Capture", `${data.usageAnalytics.receiptCapturePercent}%`],
              ["Voice Capture", `${data.usageAnalytics.voiceCapturePercent}%`],
              ["Avg Daily Questions", data.usageAnalytics.averageDailyQuestions],
              ["Dashboard Views", data.usageAnalytics.dashboardViews],
              ["Conversation Turns", data.usageAnalytics.conversationTurns],
              ["Dashboard Read", `${data.usageAnalytics.dashboardVsConversation.dashboardPercent}%`],
              ["Conversation Read", `${data.usageAnalytics.dashboardVsConversation.conversationPercent}%`]
            ]}
          />
        </Panel>

        <Panel title="Memory Evolution">
          <MetricRows
            rows={[
              ["Merchant Alias Signals", data.memoryEvolution.newMerchantAliases],
              ["Recurring Expenses", data.memoryEvolution.recurringExpenses],
              ["Household Context", data.memoryEvolution.householdContexts],
              ["Reprocess Count", data.memoryEvolution.reprocessCount]
            ]}
          />
        </Panel>

        <Panel title="AI Quality Issues">
          <MetricRows
            rows={[
              ["OCR Fail", data.aiQualityIssues.ocrFail],
              ["Merchant Unknown", data.aiQualityIssues.merchantUnknown],
              ["Category Uncertain", data.aiQualityIssues.categoryUncertain],
              ["Merge Failed", data.aiQualityIssues.mergeFailed],
              ["Low Confidence", data.aiQualityIssues.lowConfidenceMemories]
            ]}
          />
        </Panel>

        <Panel title="Household Analytics">
          <MetricRows
            rows={[
              ["Households", data.householdAnalytics.households],
              ["Active Households", data.householdAnalytics.activeHouseholds],
              ["Avg Memories / Household", data.householdAnalytics.averageMemoriesPerHousehold],
              ["Avg Daily Capture", data.householdAnalytics.averageDailyCapture],
              ["Avg AI Cost / Household", formatUsd(data.householdAnalytics.averageAiCostPerHouseholdUsd)]
            ]}
          />
        </Panel>

        <Panel title="Model Usage" className="wide">
          <div className="adminList">
            {data.aiCostAnalytics.modelUsage.length === 0 ? (
              <p>No model telemetry yet.</p>
            ) : (
              data.aiCostAnalytics.modelUsage.map((row) => (
                <div className="adminListRow" key={row.label}>
                  <span>{row.label}</span>
                  <strong>
                    {row.count} / {row.percent}%
                  </strong>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel title="Most Asked Questions" className="wide">
          <div className="adminList">
            {data.usageAnalytics.mostAskedQuestions.length === 0 ? (
              <p>No questions yet.</p>
            ) : (
              data.usageAnalytics.mostAskedQuestions.map((row) => (
                <div className="adminListRow" key={row.label}>
                  <span>{row.label}</span>
                  <strong>{row.count}</strong>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel title="Top Heavy Users" className="wide">
          <div className="adminList">
            {data.householdAnalytics.topHeavyUsers.length === 0 ? (
              <p>No household activity yet.</p>
            ) : (
              data.householdAnalytics.topHeavyUsers.map((row) => (
                <div className="adminListRow" key={row.householdId}>
                  <span>{row.householdId}</span>
                  <strong>
                    {row.captures} captures / {formatUsd(row.aiCostUsd)}
                  </strong>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel title="Recent AI Telemetry" className="wide">
          <div className="adminTelemetry">
            {data.recentTelemetry.length === 0 ? (
              <p>No AI telemetry yet.</p>
            ) : (
              data.recentTelemetry.map((event) => (
                <div className="adminTelemetryRow" key={event.id}>
                  <span>{event.phase}</span>
                  <span>{event.model}</span>
                  <span>{event.status}</span>
                  <span>{event.totalTokens ?? 0} tokens</span>
                  <strong>{formatUsd(event.estimatedCostUsd ?? 0)}</strong>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel title="Database Field Dictionary" className="wide">
          <div className="adminTableTitle">
            <h3>欄位用途：用嚟判斷 AI 點樣由 dump 變成 memory</h3>
            <ExportLinks name="schemaDictionary" scope="view" />
          </div>
          <RawTable rows={data.readableViews.schemaDictionary} />
        </Panel>

        <Panel title="AI Work Trace" className="wide">
          <div className="adminTableTitle">
            <h3>Capture → AI intent → decision → fact/context → cost</h3>
            <ExportLinks name="aiWorkTrace" scope="view" />
          </div>
          <RawTable rows={data.readableViews.aiWorkTrace} />
        </Panel>

        <Panel title="Capture Debug View" className="wide">
          <div className="adminTableTitle">
            <h3>raw input / raw transcript / cleaned transcript / final decision</h3>
            <ExportLinks name="captureDebug" scope="view" />
          </div>
          <RawTable rows={data.readableViews.captureDebug} />
        </Panel>

        <Panel title="Household Setup View" className="wide">
          <div className="adminTableTitle">
            <h3>睇 household / member / invite onboarding 狀態，好似 sheet 咁查</h3>
            <ExportLinks name="householdSetup" scope="view" />
          </div>
          <RawTable rows={data.readableViews.householdSetup} />
        </Panel>

        <Panel title="Household Roster View" className="wide">
          <div className="adminTableTitle">
            <h3>真實 household members / invites roster</h3>
            <ExportLinks name="householdRoster" scope="view" />
          </div>
          <RawTable rows={data.readableViews.householdRoster} />
        </Panel>

        <Panel title="Supabase Migration View" className="wide">
          <div className="adminTableTitle">
            <h3>normalized import plan / validation / dry-run table</h3>
            <ExportLinks name="supabaseMigration" scope="view" />
          </div>
          <RawTable rows={data.readableViews.supabaseMigration} />
        </Panel>

        <Panel title="Supabase Migration Inventory" className="wide">
          <div className="adminTableTitle">
            <h3>exact migration files, rollout stage, and checksum proof</h3>
            <ExportLinks name="migrationInventory" scope="view" />
          </div>
          <RawTable rows={data.readableViews.migrationInventory} />
        </Panel>

        <Panel title="Schema Migration Proof" className="wide">
          <div className="adminTableTitle">
            <h3>live schema drift / required migrations / next action</h3>
            <ExportLinks name="schemaMigrationProof" scope="view" />
          </div>
          <RawTable rows={data.readableViews.schemaMigrationProof} />
        </Panel>

        <Panel title="Live Rollout Table" className="wide">
          <div className="adminTableTitle">
            <h3>rollout checklist export-friendly rows</h3>
            <ExportLinks name="liveRollout" scope="view" />
          </div>
          <RawTable rows={data.readableViews.liveRollout} />
        </Panel>

        <Panel title="Google Sheet Style Views" className="wide">
          <div className="adminTableTabs">
            <section>
              <div className="adminTableTitle">
                <h3>Ledger View</h3>
                <ExportLinks name="ledger" scope="view" />
              </div>
              <RawTable rows={data.readableViews.ledger} />
            </section>
            <section>
              <div className="adminTableTitle">
                <h3>Context View</h3>
                <ExportLinks name="contextState" scope="view" />
              </div>
              <RawTable rows={data.readableViews.contextState} />
            </section>
            <section>
              <div className="adminTableTitle">
                <h3>Quality Queue</h3>
                <ExportLinks name="qualityQueue" scope="view" />
              </div>
              <RawTable rows={data.readableViews.qualityQueue} />
            </section>
          </div>
        </Panel>

        <Panel title="Raw Memory Tables" className="wide">
          <div className="adminTableTabs">
            <section>
              <div className="adminTableTitle">
                <h3>Captures</h3>
                <ExportLinks name="captures" />
              </div>
              <RawTable rows={data.rawTables.captures} />
            </section>
            <section>
              <div className="adminTableTitle">
                <h3>Interpretations</h3>
                <ExportLinks name="interpretations" />
              </div>
              <RawTable rows={data.rawTables.interpretations} />
            </section>
            <section>
              <div className="adminTableTitle">
                <h3>Facts</h3>
                <ExportLinks name="facts" />
              </div>
              <RawTable rows={data.rawTables.facts} />
            </section>
            <section>
              <div className="adminTableTitle">
                <h3>Context</h3>
                <ExportLinks name="contexts" />
              </div>
              <RawTable rows={data.rawTables.contexts} />
            </section>
            <section>
              <div className="adminTableTitle">
                <h3>Relationships</h3>
                <ExportLinks name="relationships" />
              </div>
              <RawTable rows={data.rawTables.relationships} />
            </section>
            <section>
              <div className="adminTableTitle">
                <h3>Revisions</h3>
                <ExportLinks name="revisions" />
              </div>
              <RawTable rows={data.rawTables.revisions} />
            </section>
            <section>
              <div className="adminTableTitle">
                <h3>Categories</h3>
                <ExportLinks name="categories" />
              </div>
              <RawTable rows={data.rawTables.categories} />
            </section>
            <section>
              <div className="adminTableTitle">
                <h3>Memories</h3>
                <ExportLinks name="memories" />
              </div>
              <RawTable rows={data.rawTables.memories} />
            </section>
            <section>
              <div className="adminTableTitle">
                <h3>Conversations</h3>
                <ExportLinks name="conversations" />
              </div>
              <RawTable rows={data.rawTables.conversations} />
            </section>
            <section>
              <div className="adminTableTitle">
                <h3>AI Telemetry</h3>
                <ExportLinks name="telemetry" />
              </div>
              <RawTable rows={data.rawTables.telemetry} />
            </section>
          </div>
        </Panel>
      </div>
    </main>
  );
}
