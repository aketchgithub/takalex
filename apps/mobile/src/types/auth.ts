import { z } from "zod";

export const userRoleSchema = z.enum([
  "collector",
  "site_manager",
  "recycler",
  "admin",
]);

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
export type Profile = z.infer<typeof profileSchema>;
export type UserSite = z.infer<typeof userSiteSchema>;
