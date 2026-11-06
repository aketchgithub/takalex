import { z } from "zod";

export const userRoleSchema = z.enum([
  "collector",
  "site_manager",
  "recycler",
  "admin",
]);

// Roles an administrator can invite (invite-user rejects "admin").
export const inviteRoleSchema = z.enum(["collector", "site_manager", "recycler"]);

export const roleLabels: Record<z.infer<typeof userRoleSchema>, string> = {
  admin: "Administrator",
  collector: "Collector",
  recycler: "Recycler",
  site_manager: "Site manager",
};

export const profileSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().nullable(),
  phone: z.string().nullable(),
  role: userRoleSchema,
  group_id: z.string().uuid().nullable(),
  is_active: z.boolean(),
  created_at: z.string(),
});

export const userSiteSchema = z.object({
  user_id: z.string().uuid(),
  site_id: z.string().uuid(),
  assigned_at: z.string(),
});

export type UserRole = z.infer<typeof userRoleSchema>;
export type InviteRole = z.infer<typeof inviteRoleSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type UserSite = z.infer<typeof userSiteSchema>;
