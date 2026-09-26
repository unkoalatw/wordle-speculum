# Project Speculum :: Wordle 演算法觀察室 (Wordle AI Observatory)

輕量化純前端非 LLM 人工智慧遊玩展示平台，結合**香農資訊理論 (Shannon Information Theory)**、**動態字母封印 (Handicap Matrix)**、**外部專用字典 (External Dictionaries)** 與 **[Free Dictionary API](https://dictionaryapi.dev/)** 即時釋義查詢。

---

## 🌟 核心特色 (Key Features)

- **100% 瀏覽器本地端運算 (Zero-Server AI)**：所有資訊熵矩陣運算與字典過濾皆透過 Web Workers 於瀏覽器背景線程極速執行，零雲端依賴、零延遲、高隱私。
- **數學可解釋性決策**：每步公開預期資訊量（Expected Information Gain, $E[I]$），完整呈現 243 種色彩反饋模式的加權熵值。
- **外部專用字典引擎**：
  - 內建精選資料集：NYT 官方標準目標庫 (2,315 詞)、Stanford GraphBase 詞庫 (5,757 詞)、3B1B 擴充合法詞庫 (12,954 詞)、全網極限詞庫 (14,855 詞)。
  - 支援遠端 URL 載入、本機檔案上傳 (`.txt` / `.json`) 或剪貼簿貼入。
- **[Free Dictionary API](https://dictionaryapi.dev/) 整合**：點擊單字即可即時查詢音標、真人語音發音 (Audio) 與各詞性詳細釋義。
- **動態字母封印機制 (Handicap Sandbox)**：支援母音封印、高頻輔音封印或自訂字母排除，考驗 AI 殘局求生路徑。
- **50 局全自動評測 (Monte Carlo Benchmark)**：即時壓力測試勝率與平均猜測步數（理論平均 $< 3.5$ 步）。

---

## 🚀 快速開始 (Getting Started)

本專案為純前端原生架構，無需繁瑣建置：

```bash
# 啟動本地靜態伺服器
npx -y serve -l 3000
```

在瀏覽器開啟 `http://localhost:3000` 即可體驗！

---

## 📐 資訊理論演算法公式

$$E[I(w)] = \sum_{y \in Y} p(y|w) \log_2 \left(\frac{1}{p(y|w)}\right)$$
