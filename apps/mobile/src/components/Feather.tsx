// The Feather icon set, loaded from the app's own copy of the font
// (assets/fonts/Feather.ttf, copied from @expo/vector-icons, MIT licence).
//
// Why: the web build puts @expo/vector-icons' own font under a path that
// contains "node_modules", and hosts such as Netlify leave such folders out
// of an upload, so every icon on the website was blank. With our own copy
// the font sits under assets/fonts and is uploaded like any other file.
// Same icons and names as @expo/vector-icons/Feather; import this instead.

import createIconSet from "@expo/vector-icons/createIconSet";
import ExpoFeather from "@expo/vector-icons/Feather";

const Feather = createIconSet(ExpoFeather.glyphMap, "takalex-feather", require("../../assets/fonts/Feather.ttf"));

export default Feather;
