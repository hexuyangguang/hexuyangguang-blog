这个项目把前面几篇的知识串起来用一遍：ESP32 采集温湿度 → WiFi 联网 → MQTT 上报 → 云端和手机端订阅显示。

代码基于 ESP-IDF（不是 Arduino 框架），因为 IDF 更贴近实际产品开发，也能让你真正理解 WiFi 和 MQTT 的运作方式。

## 一、整体架构

```
┌──────────────┐   I2C    ┌──────────────┐  WiFi   ┌──────────┐
│   DHT22      │◄────────►│    ESP32     │◄───────►│  路由器  │
│  温湿度传感器 │  单总线   │              │         └────┬─────┘
└──────────────┘          │  ├ 采集任务   │              │
                          │  ├ 联网任务   │              ▼
                          │  └ 上报任务   │        ┌──────────┐
                          └──────────────┘        │  EMQX    │
                                                  │  MQTT    │
                                                  └────┬─────┘
                                                       │
                                            ┌──────────┴─────────┐
                                            ▼                    ▼
                                      MQTTX 客户端        手机 App
```

分工：

- **ESP32** 负责采集和上报，不做存储和展示
- **MQTT Broker**（EMQX 公共服务器或自建）负责消息中转
- **订阅端**可以是桌面工具、网页或手机 App

这个架构的好处是**设备端极简**，后期加数据存储、告警、图表都只需要在云端做，不用改固件。

## 二、工程结构

```
esp32_env_monitor/
├── CMakeLists.txt
├── sdkconfig
└── main/
    ├── CMakeLists.txt
    ├── app_main.c          # 入口，创建任务
    ├── wifi_sta.c/.h       # WiFi 连接管理
    ├── mqtt_client.c/.h    # MQTT 上报
    └── dht22.c/.h          # 传感器驱动
```

用 `idf.py create-project` 建好骨架后，把文件填进去。

## 三、DHT22 驱动：单总线时序

DHT22（也叫 AM2302）用的是**自定义的单总线协议**，不是 I2C 也不是 SPI。它只有一根数据线，靠高低电平的持续时间传递 0 和 1。

### 3.1 通信时序

```
主机拉低 >1ms  →  拉高 20-40us  →  释放总线
                                      ↓
传感器响应: 拉低 80us  →  拉高 80us
                                      ↓
数据 40 位: 每位以 50us 低电平开始
           高电平持续 26-28us 表示 0
           高电平持续 70us    表示 1
```

40 位数据的结构：

| 字节 | 内容 |
|---|---|
| 0-1 | 湿度（高字节 + 低字节），实际值 = 原始值 / 10 |
| 2-3 | 温度（高字节 + 低字节），最高位是符号位 |
| 4 | 校验和 = 前四字节之和的低 8 位 |

### 3.2 读取实现

```c
#include "driver/gpio.h"
#include "esp_timer.h"
#include "rom/ets_sys.h"

#define DHT22_PIN   GPIO_NUM_4

/* 等待引脚到达指定电平，超时返回 -1 */
static int wait_level(int level, int timeout_us)
{
    int64_t start = esp_timer_get_time();
    while (gpio_get_level(DHT22_PIN) != level) {
        if (esp_timer_get_time() - start > timeout_us) return -1;
    }
    return 0;
}

esp_err_t dht22_read(float *temp, float *humi)
{
    uint8_t data[5] = {0};

    /* 1. 主机发起起始信号 */
    gpio_set_direction(DHT22_PIN, GPIO_MODE_OUTPUT);
    gpio_set_level(DHT22_PIN, 0);
    ets_delay_us(1200);                 /* 拉低至少 1ms */
    gpio_set_level(DHT22_PIN, 1);
    ets_delay_us(30);
    gpio_set_direction(DHT22_PIN, GPIO_MODE_INPUT);

    /* 2. 传感器响应 */
    if (wait_level(0, 100) < 0) return ESP_ERR_TIMEOUT;
    if (wait_level(1, 100) < 0) return ESP_ERR_TIMEOUT;
    if (wait_level(0, 100) < 0) return ESP_ERR_TIMEOUT;   /* 80us 低电平结束 */

    /* 3. 读 40 位数据 */
    for (int i = 0; i < 40; i++) {
        if (wait_level(1, 100) < 0) return ESP_ERR_TIMEOUT;   /* 50us 低电平结束 */

        int64_t t_start = esp_timer_get_time();
        if (wait_level(0, 100) < 0) return ESP_ERR_TIMEOUT;
        int64_t high_us = esp_timer_get_time() - t_start;

        data[i / 8] <<= 1;
        if (high_us > 40) {         /* 高电平 >40us 判为 1 */
            data[i / 8] |= 1;
        }
    }

    /* 4. 校验 */
    uint8_t sum = data[0] + data[1] + data[2] + data[3];
    if (sum != data[4]) {
        ESP_LOGE("DHT22", "校验失败: 计算 %02X, 收到 %02X", sum, data[4]);
        return ESP_ERR_INVALID_CRC;
    }

    *humi = (float)((data[0] << 8) | data[1]) / 10.0f;

    /* 温度最高位是符号位，负数要用补码方式还原 */
    int16_t raw_temp = ((data[2] & 0x7F) << 8) | data[3];
    *temp = (float)raw_temp / 10.0f;
    if (data[2] & 0x80) *temp = -*temp;

    return ESP_OK;
}
```

**几个易错点**：

1. **`ets_delay_us` 而不是 `vTaskDelay`**。后者最小粒度是一个 tick（默认 10ms），远大于这里需要的微秒级延时。
2. **读取期间要关中断**。整个 40 位读取大约 4ms，被中断打断会导致时序错乱。实测在 ESP32 上如果开了 WiFi，不关中断的话失败率很高：
   ```c
   portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
   taskENTER_CRITICAL(&mux);
   /* ... 读取时序 ... */
   taskEXIT_CRITICAL(&mux);
   ```
3. **DHT22 采样间隔不能低于 2 秒**，手册要求。频率太高会读到上一次的缓存值。

## 四、WiFi 连接：要有重连

ESP-IDF 的 WiFi 初始化是**事件驱动**的，理解事件循环是关键：

```c
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"

static const char *TAG = "WIFI";
static EventGroupHandle_t s_wifi_events;
#define WIFI_CONNECTED_BIT  BIT0

static void event_handler(void *arg, esp_event_base_t base,
                          int32_t event_id, void *event_data)
{
    if (base == WIFI_EVENT) {
        switch (event_id) {
        case WIFI_EVENT_STA_START:
            esp_wifi_connect();
            break;
        case WIFI_EVENT_STA_DISCONNECTED: {
            wifi_event_sta_disconnected_t *d = event_data;
            ESP_LOGW(TAG, "断开连接, reason=%d, 2 秒后重连", d->reason);
            /* 一定要延时，否则会疯狂重连把 CPU 占满 */
            vTaskDelay(pdMS_TO_TICKS(2000));
            esp_wifi_connect();
            xEventGroupClearBits(s_wifi_events, WIFI_CONNECTED_BIT);
            break;
        }
        default:
            break;
        }
    } else if (base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *e = event_data;
        ESP_LOGI(TAG, "获取到 IP: " IPSTR, IP2STR(&e->ip_info.ip));
        xEventGroupSetBits(s_wifi_events, WIFI_CONNECTED_BIT);
    }
}

void wifi_init_sta(void)
{
    s_wifi_events = xEventGroupCreate();

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    /* 注册事件处理 */
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        WIFI_EVENT, ESP_EVENT_ANY_ID, &event_handler, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        IP_EVENT, IP_EVENT_STA_GOT_IP, &event_handler, NULL, NULL));

    wifi_config_t wifi_config = {
        .sta = {
            .ssid     = CONFIG_WIFI_SSID,
            .password = CONFIG_WIFI_PASSWORD,
            .threshold.authmode = WIFI_AUTH_WPA2_PSK,
        },
    };

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    /* 阻塞等待连上，实际项目里可以加超时 */
    xEventGroupWaitBits(s_wifi_events, WIFI_CONNECTED_BIT,
                        pdFALSE, pdTRUE, portMAX_DELAY);
}
```

**`WIFI_EVENT_STA_DISCONNECTED` 里的延时不能省。** 如果路由器暂时不可达，不加延时会导致每秒重连几十次，CPU 被打满、日志刷屏，还可能与路由器 AP 的拒绝策略冲突。

## 五、MQTT 上报

### 5.1 主题设计

主题结构决定了后期扩展性，建议一开始就规划好：

```
device/{device_id}/telemetry      ← 设备上报数据（周期性）
device/{device_id}/status         ← 在线状态（LWT 用）
device/{device_id}/cmd            ← 云端下发命令
device/{device_id}/cmd/ack        ← 命令执行确认
```

`{device_id}` 用 MAC 地址后六位，保证唯一。

### 5.2 遗嘱消息（LWT）：让云端知道设备掉线

这是 MQTT 最有用的特性之一。设备连接时预先注册一条"遗嘱"，**一旦异常断开，Broker 自动发布这条消息**：

```c
esp_mqtt_client_config_t mqtt_cfg = {
    .broker.address.uri = CONFIG_MQTT_BROKER_URL,
    .credentials.client_id = device_id,
    .session.last_will = {
        .topic   = status_topic,
        .msg     = "{\"online\":false}",
        .msg_len = 18,
        .qos     = 1,
        .retain  = true,        /* 保留消息，新订阅者立刻能看到状态 */
    },
    .session.keepalive = 30,
};
```

`retain = true` 很关键：新订阅者一上线就能拿到最后的状态，不用等下一次上报。

### 5.3 上报实现

```c
static esp_mqtt_client_handle_t s_client;
static char s_topic_telemetry[64];
static char s_topic_status[64];

static void mqtt_event_handler(void *args, esp_event_base_t base,
                               int32_t event_id, void *event_data)
{
    esp_mqtt_event_handle_t event = event_data;

    switch ((esp_mqtt_event_id_t)event_id) {
    case MQTT_EVENT_CONNECTED:
        ESP_LOGI(TAG, "MQTT 已连接");
        /* 连接成功后先发一条在线状态 */
        esp_mqtt_client_publish(s_client, s_topic_status,
                                "{\"online\":true}", 0, 1, 1);
        esp_mqtt_client_subscribe(s_client, cmd_topic, 1);
        break;

    case MQTT_EVENT_DATA:
        ESP_LOGI(TAG, "收到命令: %.*s", event->data_len, event->data);
        handle_command(event->data, event->data_len);
        break;

    case MQTT_EVENT_DISCONNECTED:
        ESP_LOGW(TAG, "MQTT 断开，等待自动重连");
        break;

    default:
        break;
    }
}

/* 上报一条数据 */
esp_err_t mqtt_report(float temp, float humi)
{
    char payload[128];
    int len = snprintf(payload, sizeof(payload),
                       "{\"temp\":%.1f,\"humi\":%.1f,\"ts\":%lld}",
                       temp, humi, esp_timer_get_time() / 1000000);

    /* QoS 1：至少送达一次，适合传感器数据 */
    int msg_id = esp_mqtt_client_publish(s_client, s_topic_telemetry,
                                         payload, len, 1, 0);
    if (msg_id < 0) {
        ESP_LOGE(TAG, "发布失败");
        return ESP_FAIL;
    }
    ESP_LOGI(TAG, "已上报: %s", payload);
    return ESP_OK;
}
```

**QoS 怎么选**：

| QoS | 保证 | 适用 |
|---|---|---|
| 0 | 最多一次，可能丢 | 高频数据、可容忍丢失 |
| 1 | 至少一次，可能重复 | **传感器上报（最常用）** |
| 2 | 恰好一次，开销大 | 计费、关键指令 |

## 六、主程序：三个任务

```c
void app_main(void)
{
    ESP_LOGI(TAG, "启动中...");

    dht22_init();
    wifi_init_sta();
    mqtt_start();

    /* 采集并上报 */
    float temp, humi;
    int fail_count = 0;

    for (;;) {
        esp_err_t ret = dht22_read(&temp, &humi);

        if (ret == ESP_OK) {
            fail_count = 0;
            ESP_LOGI(TAG, "温度 %.1f°C  湿度 %.1f%%", temp, humi);

            if (mqtt_is_connected()) {
                mqtt_report(temp, humi);
            } else {
                ESP_LOGW(TAG, "MQTT 未连接，本条数据丢弃");
            }
        } else {
            /* 连续失败要警惕，可能是接线松动或传感器损坏 */
            if (++fail_count >= 5) {
                ESP_LOGE(TAG, "连续 %d 次读取失败，重启传感器", fail_count);
                dht22_reinit();
                fail_count = 0;
            }
        }

        vTaskDelay(pdMS_TO_TICKS(5000));    /* DHT22 要求 >= 2s */
    }
}
```

## 七、低功耗优化

如果是电池供电，功耗是核心指标。ESP32 的功耗分布大致是：

| 状态 | 电流 |
|---|---|
| WiFi 收发中 | 100-240mA |
| Modem-sleep（CPU 运行，WiFi 休眠） | 20-30mA |
| Light-sleep | ~0.8mA |
| Deep-sleep | ~10μA |

**Deep-sleep 是最省电的**，代价是每次唤醒都要重新连接 WiFi（约 2-3 秒）。适合几分钟上报一次的场合：

```c
/* 采集上报完成后进入深度睡眠 */
esp_sleep_enable_timer_wakeup(300 * 1000000ULL);   /* 300 秒 */
esp_deep_sleep_start();     /* 不会返回，唤醒后从 app_main 重新开始 */
```

如果要**更频繁上报（比如 10 秒一次）**，Deep-sleep 的重连开销就不划算了，应该用 **Light-sleep + WiFi 保持连接**，靠 DTIM 机制在两次 beacon 之间休眠。

**优化方向总结**：

- 上报周期越长，Deep-sleep 越划算
- 缩短 WiFi 连接时间：用静态 IP 免去 DHCP
- 降低发射功率：`esp_wifi_set_max_tx_power(34)`（约 8.5dBm），室内够用
- 关掉不用的外设时钟和 LED

## 八、部署与联调

### 8.1 用公共 Broker 快速验证

先用 EMQX 的公共测试服务器跑通链路，不用自己搭：

```c
#define CONFIG_MQTT_BROKER_URL  "mqtt://broker.emqx.io:1883"
```

然后用 [MQTTX](https://mqttx.app/) 这个桌面客户端订阅 `device/+/telemetry`，就能实时看到数据。

### 8.2 常见问题

| 现象 | 排查方向 |
|---|---|
| WiFi 一直连不上 | SSID/密码错；路由器开了 MAC 过滤；只支持 5G 频段（ESP32 只支持 2.4G） |
| 连上 WiFi 但 MQTT 连不上 | Broker 地址、端口错；TLS 证书没配 |
| MQTT 频繁掉线 | keepalive 太短；网络不稳；client_id 冲突（两台设备用了同一个） |
| DHT22 一直校验失败 | 没关中断；供电不足（DHT22 峰值电流可达 1.5mA，某些开发板 3.3V 输出不够） |
| 数据上报正常但云端收不到 | QoS 0 丢包；主题名大小写不匹配（MQTT 主题**区分大小写**） |
| 设备重启后状态还是"在线" | 没配 LWT，或 LWT 的 retain 没设 true |

最后一条特别常见。**没有 LWT 的话，设备断电后 Broker 不知道，云端会一直以为它在线**，直到 keepalive 超时（默认 30 秒的两倍）。

## 小结

| 环节 | 关键点 |
|---|---|
| 传感器 | 单总线时序要精确到微秒；读取期间关中断；间隔 ≥2s |
| WiFi | 事件驱动；断线重连必须加延时；处理 LWT |
| MQTT | 主题分层设计；用 retain + LWT 管理在线状态；QoS 1 是常用选择 |
| 功耗 | 低频上报用 Deep-sleep，高频用 Light-sleep |
| 调试 | 先用公共 Broker + MQTTX 验证链路，再改自建 |

这个项目跑通之后，你会发现物联网开发的套路是固定的：**采集 → 处理 → 上报 → 接收指令**。换成别的传感器、别的云平台，骨架完全一样。

---

**相关文章**：[串口、I2C、SPI 三大总线对比与实战](#/article/uart-i2c-spi) · [FreeRTOS 任务调度与优先级实战](#/article/freertos-task-scheduling)
