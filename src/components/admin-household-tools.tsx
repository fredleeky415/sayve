"use client";

import { FormEvent, useMemo, useState } from "react";

async function postAdmin(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return {
    ok: response.ok,
    json: (await response.json()) as Record<string, unknown>
  };
}

function resultText(result: Record<string, unknown> | null) {
  if (!result) return "";
  return JSON.stringify(result, null, 2);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function extractToolState(result: Record<string, unknown> | null) {
  const data = (result?.data as Record<string, unknown> | undefined) ?? {};
  const household = (data.household as Record<string, unknown> | undefined) ?? {};
  return {
    householdId: readString(household.id),
    householdName: readString(household.name),
    inviteToken: readString(data.token),
    inviteUrl: readString(data.inviteUrl),
    privateBetaInviteUrl: readString(data.privateBetaInviteUrl),
    acceptedHouseholdId: readString(data.householdId),
    error: readString(result?.error),
    currentState: readString(result?.current_state)
  };
}

function stepTone(status: "done" | "active" | "idle") {
  if (status === "done") return "done";
  if (status === "active") return "active";
  return "idle";
}

export function AdminHouseholdTools() {
  const [householdName, setHouseholdName] = useState("Lee Home");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [inviteHouseholdId, setInviteHouseholdId] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "viewer">("member");
  const [acceptToken, setAcceptToken] = useState("");
  const [acceptUserId, setAcceptUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const toolState = useMemo(() => extractToolState(result), [result]);
  const primaryInviteLink = toolState.privateBetaInviteUrl || toolState.inviteUrl;
  const createDone = Boolean(toolState.householdId);
  const inviteDone = Boolean(toolState.inviteToken || primaryInviteLink);
  const acceptDone = Boolean(toolState.acceptedHouseholdId);
  const progressRows = [
    {
      step: "1",
      title: "Create household",
      status: stepTone(createDone ? "done" : "active"),
      detail: createDone
        ? `Household ready: ${toolState.householdName || householdName} (${toolState.householdId})`
        : "Create the founder household first so partner onboarding has a real target."
    },
    {
      step: "2",
      title: "Create partner invite",
      status: stepTone(inviteDone ? "done" : createDone ? "active" : "idle"),
      detail: inviteDone
        ? "Invite link/token is ready for a separate browser profile."
        : "Generate the partner invite after the household id is filled in."
    },
    {
      step: "3",
      title: "Accept invite / verify join",
      status: stepTone(acceptDone ? "done" : inviteDone ? "active" : "idle"),
      detail: acceptDone
        ? `Invite accepted into household ${toolState.acceptedHouseholdId}.`
        : "Use the partner account to accept the invite, then record the joined household."
    }
  ];

  async function createHousehold(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const next = await postAdmin("/api/households/create", {
      name: householdName,
      ownerUserId
    });
    setResult(next.json);
    const nextState = extractToolState(next.json);
    if (nextState.householdId) setInviteHouseholdId(nextState.householdId);
    setBusy(false);
  }

  async function createInvite(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const next = await postAdmin("/api/households/invite", {
      householdId: inviteHouseholdId,
      email: inviteEmail,
      role: inviteRole
    });
    setResult(next.json);
    const nextState = extractToolState(next.json);
    if (nextState.inviteToken) setAcceptToken(nextState.inviteToken);
    setBusy(false);
  }

  async function acceptInvite(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const next = await postAdmin("/api/households/invite/accept", {
      token: acceptToken,
      userId: acceptUserId
    });
    setResult(next.json);
    setBusy(false);
  }

  return (
    <div className="adminToolGrid">
      <section className="adminToolResult adminToolSummary">
        <div className="adminToolSummaryHeader">
          <h3>Founder Onboarding Flow</h3>
          <span>{acceptDone ? "Ready for shared-household proof" : inviteDone ? "Waiting for partner join" : "Setup in progress"}</span>
        </div>
        <div className="adminToolProgress">
          {progressRows.map((row) => (
            <article className={`adminToolStep ${row.status}`} key={row.step}>
              <strong>{row.step}</strong>
              <div>
                <h4>{row.title}</h4>
                <p>{row.detail}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="adminToolFacts">
          <div>
            <span>Household ID</span>
            <strong>{toolState.householdId || inviteHouseholdId || "not created yet"}</strong>
          </div>
          <div>
            <span>Invite Token</span>
            <strong>{toolState.inviteToken || acceptToken || "not created yet"}</strong>
          </div>
          <div>
            <span>Accepted Household</span>
            <strong>{toolState.acceptedHouseholdId || "waiting for partner accept"}</strong>
          </div>
        </div>
        {primaryInviteLink ? (
          <div className="adminInviteLinks">
            {toolState.privateBetaInviteUrl ? (
              <a href={toolState.privateBetaInviteUrl} target="_blank" rel="noreferrer">
                Open private beta invite
              </a>
            ) : null}
            {toolState.inviteUrl ? (
              <a href={toolState.inviteUrl} target="_blank" rel="noreferrer">
                Open standard invite
              </a>
            ) : null}
          </div>
        ) : null}
        {toolState.error ? <p className="adminToolAlert">Last error: {toolState.error}</p> : null}
      </section>

      <form className="adminToolCard" onSubmit={createHousehold}>
        <div className="adminToolCardHeader">
          <h3>Create Household</h3>
          <span>Step 1</span>
        </div>
        <p className="adminToolHint">Create the shared family household first. The next invite step will auto-fill the returned household id.</p>
        <label>
          <span>Name</span>
          <input value={householdName} onChange={(event) => setHouseholdName(event.target.value)} />
        </label>
        <label>
          <span>Owner Supabase User ID</span>
          <input value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)} placeholder="auth.users.id" />
        </label>
        <button type="submit" disabled={busy || !ownerUserId.trim()}>
          Create household
        </button>
      </form>

      <form className="adminToolCard" onSubmit={createInvite}>
        <div className="adminToolCardHeader">
          <h3>Invite Partner</h3>
          <span>Step 2</span>
        </div>
        <p className="adminToolHint">Generate the partner invite after the household exists. Use member for your wife, viewer only for read-only testing.</p>
        <label>
          <span>Household ID</span>
          <input value={inviteHouseholdId} onChange={(event) => setInviteHouseholdId(event.target.value)} placeholder="auto-fills after create" />
        </label>
        <label>
          <span>Email</span>
          <input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="partner@example.com" />
        </label>
        <label>
          <span>Role</span>
          <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value === "viewer" ? "viewer" : "member")}>
            <option value="member">member</option>
            <option value="viewer">viewer</option>
          </select>
        </label>
        <button type="submit" disabled={busy || !inviteHouseholdId.trim()}>
          Create invite
        </button>
      </form>

      <form className="adminToolCard" onSubmit={acceptInvite}>
        <div className="adminToolCardHeader">
          <h3>Accept Invite</h3>
          <span>Step 3</span>
        </div>
        <p className="adminToolHint">Use this only for founder-side testing or controlled setup. Normal partner onboarding should still happen through the invite page in a separate browser profile.</p>
        <label>
          <span>Invite Token</span>
          <input value={acceptToken} onChange={(event) => setAcceptToken(event.target.value)} placeholder="auto-fills after invite" />
        </label>
        <label>
          <span>Partner Supabase User ID</span>
          <input value={acceptUserId} onChange={(event) => setAcceptUserId(event.target.value)} placeholder="auth.users.id" />
        </label>
        <button type="submit" disabled={busy || !acceptToken.trim() || !acceptUserId.trim()}>
          Accept invite
        </button>
      </form>

      <div className="adminToolResult">
        <div className="adminToolCardHeader">
          <h3>Raw API Result</h3>
          <span>{toolState.currentState || "debug"}</span>
        </div>
        <pre>{resultText(result) || "No action yet."}</pre>
      </div>
    </div>
  );
}
