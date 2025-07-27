# S1Filter-Manual Project Overview

This project, `S1Filter-Manual`, primarily consists of a Tampermonkey/Greasemonkey UserScript (`S1Plus.user.js`) and a UserStyle (`S1 NUX.css`) designed to enhance the browsing experience on the Stage1st forum (saraba1st.com / stage1st.com).

## Key Components

### `S1Plus.user.js` (UserScript)
This is the core functionality provider. It's a JavaScript file intended to be run by browser extensions like Tampermonkey or Greasemonkey.

**Key Features:**
-   **Thread Blocking:** Allows users to hide specific forum threads from their view.
-   **User Blocking:** Enables hiding all posts from a specified user within a thread.
-   **Blocked User Post/Thread Hiding (New Feature):**
    -   When blocking a user, there's now an option to hide all their replies (`hidePosts`) and/or all their created threads (`hideThreads`).
    -   Individual toggles for `hidePosts` and `hideThreads` are available for each blocked user in the settings panel.
    -   Global toggles (`hideBlockedUserPostsGlobal`, `hideBlockedUserThreadsGlobal`) are available in the settings to apply these hiding rules across all blocked users.
-   **Navigation Bar Customization:** Users can customize the links displayed in the main navigation bar.
-   **Auto Check-in:** Automatically performs daily check-in on the forum.
-   **Interface Customizations:** Includes options like changing the forum logo link and hiding the blacklist tip.
-   **Data Sync:** Provides functionality to export and import blocked lists for synchronization across devices.

### `S1 NUX.css` (UserStyle)
This is a CSS file intended to be used with browser extensions like Stylus. It provides a custom theme and layout adjustments for the Stage1st forum, offering various color schemes, font options, and UI tweaks.

## Installation

### For `S1Plus.user.js` (UserScript):
1.  Install a UserScript manager extension in your browser (e.g., [Tampermonkey](https://www.tampermonkey.net/) for Chrome/Edge/Opera, [Greasemonkey](https://addons.mozilla.org/en-US/firefox/addon/greasemonkey/) for Firefox).
2.  Open the `S1Plus.user.js` file in your browser or directly through your UserScript manager's dashboard.
3.  The extension should prompt you to install the script. Confirm the installation.

### For `S1 NUX.css` (UserStyle):
1.  Install a UserStyle manager extension in your browser (e.g., [Stylus](https://add0n.com/stylus.html) for Chrome/Firefox/Opera).
2.  Open the `S1 NUX.css` file.
3.  Use the Stylus extension to create a new style and paste the content of `S1 NUX.css` into it, applying it to `saraba1st.com` and `stage1st.com`.

## Usage and Configuration

After installation, the `S1Plus.user.js` script will automatically run on Stage1st forum pages.

### Accessing S1 Plus Settings:
A new "S1 Plus 设置" link will appear in the main navigation bar. Clicking this link will open a modal dialog where you can:
-   Manage your blocked threads and users.
-   Toggle the new post/thread hiding options for blocked users (both global and individual).
-   Customize the navigation bar links.
-   Export or import your blocked lists.
-   Configure other general interface settings.

## Development Notes

-   The script uses `GM_setValue` and `GM_getValue` for persistent storage, which are Tampermonkey/Greasemonkey API functions.
-   `GM_addStyle` is used for injecting dynamic CSS.
-   The script observes DOM changes using `MutationObserver` to dynamically apply blocking rules to newly loaded content.
-   The `S1 NUX.css` uses LESS preprocessor syntax, but the provided file is the compiled CSS output.
-   During development, the UI style must align with the current style and maintain a clean, modern aesthetic.
-   During modification or implementation, be careful not to affect existing functionality.

