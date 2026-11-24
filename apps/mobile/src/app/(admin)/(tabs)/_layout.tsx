import { Tabs } from "expo-router";
import { Platform, StyleSheet, View, useWindowDimensions } from "react-native";

import { Sidebar, type SidebarItem } from "@/components/Sidebar";
import { renderTabBar, tabIcon } from "@/components/TabBar";
import { showsSidebar } from "@/lib/sidebar";

// Five tabs; "Invite a team member" opens from Invitations
// (app/(admin)/invite.tsx, on the stack above the tabs). In a wide browser
// window the tabs are shown as a sidebar on the left instead of the bottom
// tab bar (lib/sidebar.ts).
//
// Sites and Account have admin-only file names (manage-sites, admin-account)
// so their web addresses do not clash with the public /sites page or the
// other roles' /account pages when the browser reloads.
const ITEMS: SidebarItem[] = [
  { name: "index", title: "Overview", icon: "grid", href: "/(admin)/(tabs)" },
  { name: "access-requests", title: "Access requests", icon: "user-check", href: "/(admin)/(tabs)/access-requests" },
  { name: "invitations", title: "Invitations", icon: "mail", href: "/(admin)/(tabs)/invitations" },
  { name: "manage-sites", title: "Sites", icon: "map-pin", href: "/(admin)/(tabs)/manage-sites" },
  { name: "admin-account", title: "Account", icon: "user", href: "/(admin)/(tabs)/admin-account" },
];

function hiddenTabBar() {
  return null;
}

export default function AdminTabsLayout() {
  const { width } = useWindowDimensions();
  const sidebar = showsSidebar(Platform.OS, width);

  return (
    <View style={styles.row}>
      {sidebar ? <Sidebar heading="Admin" items={ITEMS} /> : null}
      <View style={styles.main}>
        <Tabs screenOptions={{ headerShown: false }} tabBar={sidebar ? hiddenTabBar : renderTabBar}>
          <Tabs.Screen name="index" options={{ title: "Overview", tabBarIcon: tabIcon("grid") }} />
          <Tabs.Screen
            name="access-requests"
            options={{ title: "Access", tabBarAccessibilityLabel: "Access requests", tabBarIcon: tabIcon("user-check") }}
          />
          <Tabs.Screen name="invitations" options={{ title: "Invitations", tabBarIcon: tabIcon("mail") }} />
          <Tabs.Screen name="manage-sites" options={{ title: "Sites", tabBarIcon: tabIcon("map-pin") }} />
          <Tabs.Screen name="admin-account" options={{ title: "Account", tabBarIcon: tabIcon("user") }} />
        </Tabs>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: "row" },
  main: { flex: 1 },
});
