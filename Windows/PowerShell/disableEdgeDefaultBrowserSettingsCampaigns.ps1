
#disable Edge default browser settings campaigns

Invoke-Command -ScriptBlock { 
    # policy doc - https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies#defaultbrowsersettingscampaignenabled
    #default browser settings campaigns policy
    $keyName = 'DefaultBrowserSettingsCampaignEnabled'
    $DefaultBrowserSettingsCampaignEnabledValue = 0

    #validate Microsoft policy path
    $MicrosoftRegistryPath = 'HKLM:\SOFTWARE\Policies\Microsoft'
    $test = test-path -path $MicrosoftRegistryPath

    #create if the required path doesn't exist
    if(-not($test)){
        New-Item -Path $MicrosoftRegistryPath
    }

    #validate Microsoft\Edge policy path
    $MicrosoftEdgeRegistryPath = $MicrosoftRegistryPath + '\Edge'
    $test = test-path -path $MicrosoftEdgeRegistryPath

    #create if the required path doesn't exist
    if(-not($test)){
        New-Item -Path $MicrosoftEdgeRegistryPath
    }    

    $member = (Get-Item $MicrosoftEdgeRegistryPath).Property -contains $keyName

    if( $member ) {
        Set-ItemProperty -Path $MicrosoftEdgeRegistryPath -Name $keyName -Value $DefaultBrowserSettingsCampaignEnabledValue
    }
    else {
        New-ItemProperty -Path $MicrosoftEdgeRegistryPath -Name $keyName -PropertyType DWORD -Value $DefaultBrowserSettingsCampaignEnabledValue
    } 

    #print enrollment token
    #Get-ItemProperty -Path $MicrosoftEdgeRegistryPath -Name $keyName
}
