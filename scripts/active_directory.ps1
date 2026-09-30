$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if (!(Get-Module -ListAvailable ActiveDirectory)) { throw 'Install the RSAT Active Directory PowerShell module on the Atlas host using your approved software process.' }
Import-Module ActiveDirectory -ErrorAction Stop
$opts=@{}
if($server){$opts.Server=$server}
$common=@('CanonicalName','Description','Created','Modified','LastLogonDate','PasswordLastSet','PasswordNeverExpires','MemberOf','PrimaryGroupID')
if($kind -eq 'user') {
 $properties=$common+@('LockedOut','PasswordExpired','AccountExpirationDate','EmailAddress','Department','Title','Manager')
 if($identity.Contains('@')) {
  $matches=@(Get-ADUser -Filter "UserPrincipalName -eq '$identity'" -Properties $properties @opts)
  if($matches.Count -ne 1){throw 'The UPN did not resolve to exactly one user. Check the domain/server.'}
  $o=$matches[0]
 } else { $o=Get-ADUser -Identity $identity -Properties $properties @opts }
} else {
 $o=Get-ADComputer -Identity $identity -Properties ($common+@('DNSHostName','OperatingSystem','OperatingSystemVersion')) @opts
}
function DateText($v){if($null -ne $v){([datetime]$v).ToString('o')}else{$null}}
$parent=([regex]::Match($o.DistinguishedName,'^(?:\\.|[^,])*,(.*)$')).Groups[1].Value
$details=[ordered]@{
 Name=$o.Name;Account=$o.SamAccountName;UPN=$o.UserPrincipalName;Enabled=$o.Enabled
 'OU / parent container'=$parent;'Canonical path'=$o.CanonicalName;'Distinguished name'=$o.DistinguishedName
 SID=[string]$o.SID;Description=$o.Description
 Created=(DateText $o.Created);Modified=(DateText $o.Modified)
 'Last logon (replicated, approximate)'=(DateText $o.LastLogonDate)
 'Password last set'=(DateText $o.PasswordLastSet);'Password never expires'=$o.PasswordNeverExpires
}
if($kind -eq 'user') {
 $details['Locked out']=$o.LockedOut;$details['Password expired']=$o.PasswordExpired
 $details['Account expiration']=DateText $o.AccountExpirationDate
 $details['Email']=$o.EmailAddress;$details['Department']=$o.Department;$details['Job title']=$o.Title;$details['Manager DN']=$o.Manager
} else {
 $details['DNS hostname']=$o.DNSHostName;$details['Operating system']=$o.OperatingSystem;$details['OS version']=$o.OperatingSystemVersion
}
$groups=@();$warnings=@();$membership=@($o.MemberOf | Sort-Object)
foreach($dn in ($membership | Select-Object -First 500)) {
 try { $g=Get-ADGroup -Identity $dn @opts; $groups+=@{name=$g.Name;dn=$g.DistinguishedName;scope=[string]$g.GroupScope;category=[string]$g.GroupCategory;membership='Direct'} }
 catch { $groups+=@{name=$dn;dn=$dn;scope='Unavailable';category='Unavailable';membership='Direct'};$warnings+='Some group details could not be resolved; membership DNs are still shown.' }
}
if($membership.Count -gt 500){$warnings+='Only the first 500 direct groups are shown.'}
try {
 $sid=$o.SID.AccountDomainSid.Value+'-'+$o.PrimaryGroupID
 $g=Get-ADGroup -Identity $sid @opts
 $groups+=@{name=$g.Name;dn=$g.DistinguishedName;scope=[string]$g.GroupScope;category=[string]$g.GroupCategory;membership='Primary'}
} catch {$warnings+='Primary group could not be resolved.'}
@{kind=$kind;queried_at=[datetime]::UtcNow.ToString('o');server=$(if($server){$server}else{'Default domain discovery'});operator=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;details=$details;groups=@($groups);warnings=@($warnings|Select-Object -Unique);membership_note='Direct membership plus primary group. Nested/transitive memberships and effective permissions are not calculated.'} | ConvertTo-Json -Depth 6 -Compress
