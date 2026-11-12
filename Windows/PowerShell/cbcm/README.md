# Random CBCM Scripts


## Move browsers between OU using enrollment token 
Consider using the [Move Re-enroll Browser script](MoveReEnrollBrowser.ps1) to move enrolled browsers between OUs based on the enrollment token. In order to update registry settings, the script should run under the System context. 

This feature is only available via an allowlist - please contaact your Chrome Browser Enterprise team to add your domain to the allowlist. 

**Note:** Insert the enrollment token from the Google Admin console in [line](MoveReEnrollBrowser.ps1#L3) before running the script.

```
.\MoveReEnrollBrowser.ps1
```

