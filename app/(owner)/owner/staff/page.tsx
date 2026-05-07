"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { User, Location } from "@/lib/supabase/types";
import { Plus } from "lucide-react";

const supabase = createClient();

export default function StaffPage() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    location_id: "",
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: locations } = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const { data } = await supabase
        .from("locations")
        .select("*")
        .eq("is_active", true);
      return (data ?? []) as Location[];
    },
  });

  const { data: staff, isLoading } = useQuery({
    queryKey: ["staff"],
    queryFn: async () => {
      const { data } = await supabase
        .from("users")
        .select("*, locations(name)")
        .eq("role", "staff")
        .order("created_at", { ascending: false });
      return (data ?? []) as (User & { locations: { name: string } | null })[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (values: typeof form) => {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = (await res.json()) as
        | { success: true }
        | { success: false; error: string };
      if (!body.success) throw new Error(body.error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      setDialogOpen(false);
      setForm({ name: "", email: "", password: "", location_id: "" });
      setErrorMsg(null);
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from("users")
        .update({ is_active: active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    createMutation.mutate(form);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Staff</h1>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          Add Staff
        </Button>
      </div>

      {isLoading && <p className="text-gray-500">Loading...</p>}

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">
                Name
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">
                Email
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">
                Location
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">
                Status
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {staff?.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-3 font-medium text-gray-900">
                  {s.name}
                </td>
                <td className="px-4 py-3 text-gray-500">{s.email}</td>
                <td className="px-4 py-3 text-gray-500">
                  {s.locations?.name ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={s.is_active ? "success" : "secondary"}>
                    {s.is_active ? "Active" : "Inactive"}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      toggleActiveMutation.mutate({
                        id: s.id,
                        active: !s.is_active,
                      })
                    }
                  >
                    {s.is_active ? "Deactivate" : "Reactivate"}
                  </Button>
                </td>
              </tr>
            ))}
            {staff?.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-gray-400"
                >
                  No staff yet. Add your first staff member.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Staff Member</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sname">Name</Label>
              <Input
                id="sname"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="semail">Email</Label>
              <Input
                id="semail"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="spwd">Temporary Password</Label>
              <Input
                id="spwd"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                minLength={8}
              />
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Select
                value={form.location_id}
                onValueChange={(v) => setForm({ ...form, location_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Assign location" />
                </SelectTrigger>
                <SelectContent>
                  {locations?.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {errorMsg && (
              <p className="text-sm text-destructive">{errorMsg}</p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
