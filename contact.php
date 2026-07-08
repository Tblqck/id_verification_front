<?php
/**
 * idntory marketing site — contact form handler.
 *
 * Sends submissions via the Resend HTTPS API. mail.idntory.com's SMTP
 * ports are unreachable (the domain is proxied through Cloudflare, which
 * only forwards HTTP/HTTPS), so raw SMTP doesn't work — Resend's API does,
 * since it's a plain HTTPS call.
 *
 * Reads config from a ".env" file placed next to this script (see
 * loadEnv() below) or from real environment variables if your host sets
 * them another way (e.g. cPanel's MultiPHP / app config).
 *
 *   RESEND_API_KEY   from resend.com -> API Keys
 *   RESEND_FROM      verified sender, e.g. "idntory <onboarding@resend.dev>"
 *   CONTACT_TO       where submissions are delivered
 */

header('Content-Type: application/json');

function loadEnv(string $path): void {
    if (!is_file($path)) return;
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') continue;
        $parts = explode('=', $line, 2);
        if (count($parts) !== 2) continue;
        $key = trim($parts[0]);
        $value = trim($parts[1]);
        if ($key !== '' && getenv($key) === false) {
            putenv("$key=$value");
        }
    }
}

loadEnv(__DIR__ . '/.env');

$REASON_LABELS = [
    'api' => 'Request API access',
    'sales' => 'Contact sales',
    'compliance' => 'Compliance / security question',
    'other' => 'Something else',
];

function respond(int $status, array $payload): void {
    http_response_code($status);
    echo json_encode($payload);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, ['ok' => false, 'error' => 'Method not allowed']);
}

$raw = file_get_contents('php://input', false, null, 0, 20000);
$data = json_decode($raw ?: '', true);
if (!is_array($data)) {
    respond(400, ['ok' => false, 'error' => 'Invalid JSON']);
}

$name = substr(trim((string)($data['name'] ?? '')), 0, 200);
$email = substr(trim((string)($data['email'] ?? '')), 0, 200);
$company = substr(trim((string)($data['company'] ?? '')), 0, 200);
$reason = substr(trim((string)($data['reason'] ?? 'other')), 0, 40);
$message = substr(trim((string)($data['message'] ?? '')), 0, 5000);

if ($name === '' || $message === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    respond(400, ['ok' => false, 'error' => 'Name, a valid email, and a message are required']);
}

$resendKey = getenv('RESEND_API_KEY') ?: '';
$resendFrom = getenv('RESEND_FROM') ?: 'idntory <onboarding@resend.dev>';
$contactTo = getenv('CONTACT_TO') ?: 'info@idntory.com';
$reasonLabel = $REASON_LABELS[$reason] ?? $reason;

if ($resendKey === '') {
    // Dev fallback: no API key configured — log instead of failing the form.
    error_log('[CONTACT] (RESEND_API_KEY not configured, logging only) ' . json_encode(compact('name', 'email', 'company', 'reason', 'message')));
    respond(200, ['ok' => true, 'status' => 'logged']);
}

$text = "Name: $name\n"
    . "Email: $email\n"
    . 'Company: ' . ($company !== '' ? $company : '—') . "\n"
    . "Reason: $reasonLabel\n\n"
    . "Message:\n$message\n";

$payload = json_encode([
    'from' => $resendFrom,
    'to' => [$contactTo],
    'reply_to' => $email,
    'subject' => "[idntory contact] $reasonLabel — $name",
    'text' => $text,
]);

$ch = curl_init('https://api.resend.com/emails');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $payload,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . $resendKey,
        'Content-Type: application/json',
    ],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 20,
]);
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr = curl_error($ch);
curl_close($ch);

if ($curlErr !== '' || $httpCode >= 300) {
    error_log("[CONTACT ERR] Resend $httpCode: " . ($curlErr !== '' ? $curlErr : $response));
    respond(502, [
        'ok' => false,
        'error' => 'Could not send email right now',
        // TEMPORARY debug fields — remove once the live issue is diagnosed.
        'debug_http_code' => $httpCode,
        'debug_curl_err' => $curlErr,
        'debug_resend_body' => $response,
        'debug_resend_key_len' => strlen($resendKey),
        'debug_from' => $resendFrom,
        'debug_to' => $contactTo,
    ]);
}

respond(200, ['ok' => true, 'status' => 'sent']);
