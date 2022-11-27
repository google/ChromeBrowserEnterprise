# Random Scripts
## Wake Browser
Consider using the [wake browser script](https://github.com/google/ChromeBrowserEnterprise/blob/main/ps/src/WakeBrowser.ps1) to run Chrome silently under the System context to allow version data to update to the Windows registry. 

```
.\WakeBrowser.ps1
```

## Force Update
Consider using the [ForceBrowserUpdate](https://github.com/google/ChromeBrowserEnterprise/blob/main/ps/src/ForceBrowserUpdate.zip) to force an update and run Chrome silently under the System context to allow version data to update to the Windows registry. Note: After unzipping, remember to unblock the contents. Otherwise, Windows will prompt a security warning.

Dependencies

[update3web_demo](https://github.com/google/ChromeBrowserEnterprise/blob/main/ps/src/update3web_demo.js) from the [Google Omaha team](https://github.com/google/omaha/tree/main/omaha/tools/performondemand) :heart:.

[Wake Browser](https://github.com/google/ChromeBrowserEnterprise/tree/main/ps/src#wake-browser)
```
cscript update3web_demo.js {8A69D345-D564-463c-AFF1-A69D9E530F96} 1 3
```
arg[0] {8A69D345-D564-463c-AFF1-A69D9E530F96} is the Chrome Stable product guid.

arg[1] 1 applies to the Machine.

arg[2] 3 perform an Update.
