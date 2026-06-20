"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import {
  ArrowLeft, Mail, MapPin, Calendar, Clock, Eye, EyeOff, Copy, Check,
  Banknote, UserPlus, Plus, UserX, Receipt,
} from "lucide-react";

type ActivityType = "bill" | "walk_in" | "extra" | "no_show";

interface ActivityItem {
  type:           ActivityType;
  timestamp:      string;
  customer_name:  string | null;
  amount:         number | null;
  order_id:       string | null;
  description:    string;
}

interface StatsBucket {
  bills_collected:  { count: number; total: number };
  walk_ins_started: { count: number; total: number };
  extras_added:     { count: number; total: number };
  avg_ticket:       number;
}

export interface StaffDetailData {
  profile: {
    id:             string;
    name:           string;
    email:          string;
    role:           "owner" | "staff";
    location_id:    string | null;
    location_name:  string | null;
    is_active:      boolean;
    created_at:     string;
    login_password: string | null;
    last_active_at: string | null;
  };
  stats:    { today: StatsBucket; last_7d: StatsBucket; last_30d: StatsBucket };
  activity: ActivityItem[];
}

const RANGE_LABELS = { today: "Today", last_7d: "Last 7 days", last_30d: "Last 30 days" } as const;
type RangeKey = keyof typeof RANGE_LABELS;

const ACTIVITY_LABELS: Record<ActivityType, string> = {
  bill:     "Bill",
  walk_in:  "Walk-in",
  extra:    "Extra",
  no_show:  "No-show",
};

const ACTIVITY_ICONS: Record<ActivityType, React.ComponentType<{ className?: string }>> = {
  bill:     Banknote,
  walk_in:  UserPlus,
  extra:    Plus,
  no_show:  UserX,
};

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function fmtAbsolute(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export function StaffDetailContent({
  initial, staffId,
}: { initial: StaffDetailData; staffId: string }) {
  const { data } = useQuery({
    queryKey:    ["staff-profile", staffId],
    queryFn:     async (): Promise<StaffDetailData> => {
      const res = await fetch(`/api/staff/${staffId}/profile`);
      const body = await res.json() as { success: boolean; data: StaffDetailData };
      return body.data;
    },
    initialData: initial,
    initialDataUpdatedAt: Date.now(),
    staleTime:   0,
  });

  const { profile, stats, activity } = data;

  const [range, setRange] = useState<RangeKey>("last_7d");
  const [showPassword, setShowPassword] = useState(false);
  const [filter, setFilter] = useState<"all" | ActivityType>("all");
  const [copied, setCopied] = useState<"email" | "password" | null>(null);

  const bucket = stats[range];

  function copy(value: string, key: "email" | "password") {
    void navigator.clipboard.writeText(value);
    setCopied(key);
    toast.success(`${key === "email" ? "Email" : "Password"} copied`);
    setTimeout(() => setCopied(null), 1500);
  }

  const filteredActivity = filter === "all" ? activity : activity.filter(a => a.type === filter);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/owner/staff"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All staff
        </Link>
      </div>

      {/* Identity card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4 min-w-0">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold text-white shrink-0"
              style={{ background: "#D4541A" }}
            >
              {profile.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{profile.name}</h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant={profile.is_active ? "success" : "secondary"}>
                  {profile.is_active ? "Active" : "Inactive"}
                </Badge>
                <Badge variant="outline">{profile.role}</Badge>
                {profile.location_name && (
                  <span className="text-sm text-gray-500 flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {profile.location_name}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 flex-wrap">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Joined {fmtRelative(profile.created_at)}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Last active {fmtRelative(profile.last_active_at)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Login credentials */}
        <div className="mt-6 pt-5 border-t border-gray-100">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Login credentials</p>
          <div className="space-y-2">
            <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
              <Mail className="h-3.5 w-3.5 text-gray-400 shrink-0" />
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider w-20 shrink-0">Email</span>
              <span className="font-mono text-sm flex-1 truncate">{profile.email}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copy(profile.email, "email")}>
                {copied === "email" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
            {profile.login_password ? (
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                <div className="h-3.5 w-3.5 shrink-0 flex items-center justify-center text-gray-400 text-xs font-bold">∗</div>
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider w-20 shrink-0">Password</span>
                <span className="font-mono text-sm flex-1 truncate">
                  {showPassword ? profile.login_password : "•".repeat(Math.min(profile.login_password.length, 12))}
                </span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowPassword(v => !v)} title={showPassword ? "Hide" : "Show"}>
                  {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copy(profile.login_password ?? "", "password")}>
                  {copied === "password" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-gray-400 px-3 py-2">
                Password not stored (this staff was created before the credential view was added).
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Performance */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Performance</h2>
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-gray-100">
            {(Object.keys(RANGE_LABELS) as RangeKey[]).map(k => (
              <button
                key={k}
                onClick={() => setRange(k)}
                className="px-3 py-1 rounded-md text-xs font-bold transition-colors"
                style={
                  range === k
                    ? { background: "#D4541A", color: "#fff" }
                    : { color: "#6b7280" }
                }
              >
                {RANGE_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-gray-100">
          <StatCell
            icon={Banknote}
            label="Bills collected"
            count={bucket.bills_collected.count}
            total={bucket.bills_collected.total}
          />
          <StatCell
            icon={UserPlus}
            label="Walk-ins started"
            count={bucket.walk_ins_started.count}
            total={bucket.walk_ins_started.total}
          />
          <StatCell
            icon={Plus}
            label="Extras added"
            count={bucket.extras_added.count}
            total={bucket.extras_added.total}
          />
          <StatCell
            icon={Receipt}
            label="Avg ticket"
            total={bucket.avg_ticket}
            hideCount
          />
        </div>
      </div>

      {/* Activity feed */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-wrap gap-3">
          <h2 className="font-semibold text-gray-900">Recent activity</h2>
          <div className="flex items-center gap-1 flex-wrap">
            {(["all", "bill", "walk_in", "extra", "no_show"] as const).map(k => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className="px-2.5 py-1 rounded-md text-xs font-semibold transition-colors"
                style={
                  filter === k
                    ? { background: "#111", color: "#fff" }
                    : { background: "#f3f4f6", color: "#6b7280" }
                }
              >
                {k === "all" ? "All" : ACTIVITY_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
        {filteredActivity.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">
            No activity in this view.
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {filteredActivity.map((a, i) => {
              const Icon = ACTIVITY_ICONS[a.type];
              return (
                <li key={i} className="flex items-center gap-3 px-6 py-3 hover:bg-gray-50/50 transition-colors">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={
                      a.type === "bill"     ? { background: "rgba(16,185,129,0.1)",  color: "#10b981" } :
                      a.type === "walk_in"  ? { background: "rgba(212,84,26,0.1)",   color: "#D4541A" } :
                      a.type === "extra"    ? { background: "rgba(99,102,241,0.1)",  color: "#6366f1" } :
                                              { background: "rgba(239,68,68,0.1)",   color: "#ef4444" }
                    }
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{a.description}</p>
                    {a.customer_name && a.type !== "walk_in" && (
                      <p className="text-xs text-gray-500 truncate">{a.customer_name}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-gray-400 tabular-nums" title={a.timestamp}>
                    {fmtAbsolute(a.timestamp)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatCell({
  icon: Icon, label, count, total, hideCount,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count?: number;
  total: number;
  hideCount?: boolean;
}) {
  return (
    <div className="p-5">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-gray-100">
          <Icon className="h-3.5 w-3.5 text-gray-500" />
        </div>
        <span className="text-xs text-gray-500 font-medium">{label}</span>
      </div>
      {!hideCount && (
        <p className="text-2xl font-bold text-gray-900 tabular-nums">{count}</p>
      )}
      <p className={`${hideCount ? "text-2xl font-bold text-gray-900" : "text-sm text-gray-500"} tabular-nums`}>
        {formatCurrency(total)}
      </p>
    </div>
  );
}
