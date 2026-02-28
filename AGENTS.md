# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

S1 Plus is a Tampermonkey/Greasemonkey userscript that enhances the Stage1st forum experience. It's a single-file JavaScript application (~4,500 lines) providing advanced forum management features including post/user blocking, user tagging, reply bookmarking, reading progress tracking, and cloud synchronization.

## Development Commands

This project has no traditional build system. Development workflow:

- **Direct editing**: Edit `S1Plus.user.js` directly
- **Testing**: Install the script in Tampermonkey/Greasemonkey and test in browser
- **Version updates**: Manually update version in script metadata (lines 4, 20)
- **Distribution**: Upload to GreasyFork for auto-updates

## Architecture & Key Patterns

### Single-File Architecture
All functionality is contained in `S1Plus.user.js`. The script follows these patterns:

- **Data Storage**: Uses Greasemonkey API (`GM_setValue`, `GM_getValue`) for persistence
- **UI Creation**: Dynamic HTML generation with CSS injection via `GM_addStyle`
- **Event Handling**: Delegated event listeners for dynamically created elements
- **Async Operations**: Modern async/await for cloud sync operations
- **Naming Convention**: `s1p` prefix for all script-specific elements and functions

### Core Components

1. **Settings Modal** (`createManagementModal`): Central configuration interface with 7 tabs
2. **Cloud Sync System**: GitHub Gist-based synchronization with SHA-256 integrity verification
3. **Content Filtering**: Post/user blocking with regex/keyword support
4. **UI Enhancements**: Reading progress, image management, navigation customization

### Data Structures

Key data objects stored via GM API:
- `s1p_blockedThreads`: Blocked post IDs
- `s1p_blockedUsers`: Blocked user data with linked blocking options
- `s1p_userTags`: User tagging system
- `s1p_bookmarkedReplies`: Bookmarked replies (v5.0+)
- `s1p_readingProgress`: Reading position tracking
- `s1p_syncData`: Cloud sync configuration and timestamps

### Security Considerations

- **GitHub PAT Handling**: Personal Access Tokens are stored locally, never logged
- **Data Integrity**: SHA-256 hash verification prevents corrupted sync data
- **Conflict Resolution**: User choice for handling sync conflicts
- **Input Validation**: Regex patterns validated before application

## Development Guidelines

### When Adding Features
1. Follow existing `s1p` naming convention
2. Add corresponding UI in appropriate settings tab
3. Include data in sync system if user-configurable
4. Update version number and changelog
5. Test on both standard and S1 NUX themes

### Code Style
- Chinese comments for user-facing features
- English for technical implementation
- Consistent indentation (4 spaces)
- Descriptive function names with clear purpose

### Testing Considerations
- Test on different Stage1st page types (forum list, thread view, search results)
- Verify compatibility with S1 NUX theme
- Check mobile responsiveness
- Test sync functionality with different network conditions
- Validate data migration from older versions

### Common Pitfalls
- Forum structure changes may break selectors
- Sticky posts require special handling
- Different URL patterns affect feature detection
- Sync conflicts need careful timestamp handling
- CSS conflicts with forum's dynamic styling