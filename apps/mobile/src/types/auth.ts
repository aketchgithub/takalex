import { z } from "zod";

export const userRoleSchema = z.enum(["collector", "admin", "recycler"]);

export const profileSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().nullable(),
  phone: z.string().nullable(),
  role: userRoleSchema,
  site_id: z.string().uuid().nullable(),
  group_id: z.string().uuid().nullable(),
  is_active: z.boolean(),
  created_at: z.string(),
});

export type UserRole = z.infer<typeof userRoleSchema>;
export type Profile = z.infer<typeof profileSchema>;
