$ErrorActionPreference = 'Stop'

function Read-Secret([string]$prompt) {
  $secure = Read-Host $prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

Write-Host 'JARVIS // CONFIGURACAO SEGURA' -ForegroundColor Green
Write-Host 'A chave sera salva nas variaveis do seu usuario do Windows e nao entra no Git.'
$openAiKey = Read-Secret 'Cole sua OPENAI_API_KEY'
if ([string]::IsNullOrWhiteSpace($openAiKey)) { throw 'A chave OpenAI nao foi informada.' }
[Environment]::SetEnvironmentVariable('OPENAI_API_KEY', $openAiKey, 'User')

$model = Read-Host 'Modelo OpenAI (Enter para gpt-4o-mini)'
if ([string]::IsNullOrWhiteSpace($model)) { $model = 'gpt-4o-mini' }
[Environment]::SetEnvironmentVariable('OPENAI_MODEL', $model, 'User')

$configureGoogle = Read-Host 'Configurar Google OAuth agora? (s/N)'
if ($configureGoogle -match '^(s|sim|y|yes)$') {
  $clientId = Read-Host 'GOOGLE_CLIENT_ID'
  $clientSecret = Read-Secret 'GOOGLE_CLIENT_SECRET'
  [Environment]::SetEnvironmentVariable('GOOGLE_CLIENT_ID', $clientId, 'User')
  [Environment]::SetEnvironmentVariable('GOOGLE_CLIENT_SECRET', $clientSecret, 'User')
  [Environment]::SetEnvironmentVariable('GOOGLE_REDIRECT_URI', 'http://127.0.0.1:4280/auth/google/callback', 'User')
}

Write-Host 'Configuracao salva. Feche e abra o NIGHTWATCH para aplicar.' -ForegroundColor Green

