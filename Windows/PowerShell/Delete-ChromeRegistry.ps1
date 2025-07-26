<#
.SYNOPSIS
    Recursively deletes a specified registry key after checking for its existence.

.DESCRIPTION
    This script targets the "HKEY_CURRENT_USER\Software\Google\Chrome" registry path.
    It first verifies if the key exists. If it does, the script deletes the key
    and all of its subkeys and values. All actions, successes, and errors are
    logged to a text file in the script's execution directory.

.NOTES
    Execution Policy: You may need to change PowerShell's execution policy to run the script. Open PowerShell as an Administrator and run the following command:
    Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
    Run this script with appropriate permissions. Incorrect use can affect system stability.
    After running the script, a file named Registry-Deletion-Log.txt will appear in the same directory.
    b/430559703
#>

#--- Script Configuration ---

# Set the target registry path. HKCU: is the PowerShell alias for HKEY_CURRENT_USER.
$RegistryPath = "HKCU:\Software\Google\Chrome"

# Define the name for the log file.
$LogFileName = "Registry-Deletion-Log.txt"

# Automatically determine the script's directory and set the full log file path.
# $PSScriptRoot is an automatic variable that contains the directory of the script.
$LogFilePath = Join-Path -Path $PSScriptRoot -ChildPath $LogFileName

#--- Script Execution ---

# Start a transcript to log all console output to the specified file.
# -Append will add to the log file if it already exists.
Start-Transcript -Path $LogFilePath -Append

# Get the current timestamp for logging purposes.
$Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Write-Host "[$Timestamp] --- Starting Registry Deletion Script ---"
Write-Host "[$Timestamp] Target Key: $RegistryPath"
Write-Host "[$Timestamp] Log File Location: $LogFilePath"
Write-Host "" # Add a blank line for readability.

# Check if the registry path exists before attempting any action.
if (Test-Path -Path $RegistryPath) {
    Write-Host "[$Timestamp] [INFO] Registry key found at '$RegistryPath'."
    
    # Use a try...catch block to handle potential errors during deletion (e.g., permissions issues).
    try {
        Write-Host "[$Timestamp] [ACTION] Attempting to recursively delete the key..."
        
        # -Recurse deletes all child items. -Force attempts to remove items that can't otherwise be deleted.
        # -ErrorAction Stop ensures that any error will trigger the catch block immediately.
        Remove-Item -Path $RegistryPath -Recurse -Force -ErrorAction Stop
        
        Write-Host "[$Timestamp] [SUCCESS] Successfully deleted registry key and all its contents."
    }
    catch {
        # This block runs if an error occurs in the 'try' block.
        # $_ represents the error object.
        Write-Error "[$Timestamp] [ERROR] Failed to delete registry key. Details below."
        Write-Error $_
    }
}
else {
    # This block runs if Test-Path returns false.
    Write-Host "[$Timestamp] [INFO] Registry key not found. No action required."
}

Write-Host "" # Add a blank line for readability.
Write-Host "[$Timestamp] --- Script Execution Finished ---"

# Stop the transcript to save and close the log file.
Stop-Transcript
