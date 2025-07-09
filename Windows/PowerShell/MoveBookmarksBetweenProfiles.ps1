$SourceProfile = "Default"   # Replace with the actual source profile name (e.g., "Profile 1")
$TargetProfile = "Profile 2" # Replace with the actual target profile name

# Get Chrome's User Data directory path
$UserDataPath = [Environment]::GetFolderPath("LocalApplicationData") + "\Google\Chrome\User Data"

# Construct paths to Bookmarks files
$SourceBookmarksPath = "$UserDataPath\$SourceProfile\Bookmarks"
$TargetBookmarksPath = "$UserDataPath\$TargetProfile\Bookmarks"

# Ensure source profile and Bookmarks file exist
if (!(Test-Path $SourceBookmarksPath)) {
    Write-Error "Source profile or Bookmarks file not found."
    exit 1
}

# Backup the target profile's Bookmarks (optional but recommended)
if (Test-Path $TargetBookmarksPath) {
    $BackupPath = $TargetBookmarksPath + ".bak"
    Copy-Item $TargetBookmarksPath $BackupPath
}

# Copy Bookmarks from source to target
Copy-Item $SourceBookmarksPath $TargetBookmarksPath

Write-Output "Bookmarks transferred successfully from '$SourceProfile' to '$TargetProfile'."
