/* ============================================================
 * 站点配置 —— 全站唯一的"后台"
 *
 * 新增一篇文章只需两步：
 *   1. 在 posts/ 目录下新建 <slug>.md，写入正文
 *   2. 在下方 posts 数组里加一条元数据（slug 要和文件名一致）
 * ============================================================ */

var SITE_CONFIG = {
  /* ---------- 品牌信息 ---------- */
  title: '和煦阳光',
  tagline: '嵌入式技术笔记',
  description: '嵌入式软件工程师 | C语言 / STM32 / ESP32 / FreeRTOS / 嵌入式Linux 技术笔记与项目实战',
  author: '和煦阳光',
  authorTitle: '嵌入式软件工程师',
  avatarText: '阳',
  bio: '嵌入式软件工程师，专注 C 语言、STM32、ESP32 与嵌入式 Linux。做过几款量产的智能硬件产品，习惯把踩过的坑和调试过程记录下来。',
  copyrightYear: '2025-2026',

  /* ---------- 社交链接（改成你自己的地址） ---------- */
  socials: [
    { name: 'GitHub', url: 'https://github.com/yourname' },
    { name: '知乎', url: 'https://www.zhihu.com/people/yourname' },
    { name: 'CSDN', url: 'https://blog.csdn.net/yourname' }
  ],

  /* ---------- 站点根路径（自动推导，通常不用改） ----------
   * Hash 路由下 location.pathname 始终是站点根，'#/' 之后的部分不影响它。
   *   EdgeOne Pages       https://xxx.edgeone.app/       -> '/'
   *   GitHub Pages 项目页  https://user.github.io/repo/   -> '/repo/'
   *   GitHub Pages 用户页  https://user.github.io/        -> '/'
   * 因此同一份代码在两种平台都能直接跑，无需分别配置。
   */
  baseUrl: (function () {
    var p = window.location.pathname;
    // 直接访问 /repo/index.html 时，去掉文件名只保留目录
    if (/\.[a-zA-Z0-9]+$/.test(p)) p = p.replace(/\/[^/]*$/, '/');
    return p.charAt(p.length - 1) === '/' ? p : p + '/';
  })(),

  /* ---------- 侧边栏标签云 ---------- */
  /* 这里的标签要和文章 tags 里用到的保持一致，
   * 否则会出现"卡片上有这个标签、但侧边栏标签云里找不到"的情况 */
  globalTags: [
    'STM32', 'C语言', 'FreeRTOS', 'ESP32', '嵌入式Linux', '中断',
    '通信协议', 'PCB设计', '调试', '物联网', '驱动开发', '项目实战',
    '学习路线', '指针', '位操作', '开发工具'
  ],

  /* ---------- 文章元数据 ---------- */
  posts: [
    {
      slug: 'embedded-learning-roadmap',
      title: '嵌入式学习路线：从零基础到项目实战',
      date: '2026-01-12',
      category: '入门指南',
      tags: ['学习路线', 'C语言', '项目实战'],
      excerpt: '把嵌入式这条路上的知识点串成一条线：C语言基础 → 单片机入门 → 外设驱动 → RTOS → 嵌入式Linux。每个阶段该学什么、学到什么程度算过关、哪些坑可以提前绕开，一次讲清楚。',
      published: true
    },
    {
      slug: 'c-pointers-and-bitops',
      title: 'C语言指针与位操作：嵌入式的两大基本功',
      date: '2026-02-08',
      category: '编程基础',
      tags: ['C语言', '指针', '位操作'],
      excerpt: '寄存器操作、内存映射、协议解析，底层代码里到处都是指针和位运算。本文用实际场景讲解多级指针、函数指针、位域与常用位操作技巧，帮你写出真正"嵌入式味道"的 C 代码。',
      published: true
    },
    {
      slug: 'stm32-dev-environment',
      title: 'STM32 开发环境搭建与第一个工程',
      date: '2026-03-15',
      category: '外设驱动',
      tags: ['STM32', '开发工具', '驱动开发'],
      excerpt: '从零搭建一套顺手的 STM32 开发环境：工具链选型、Keil 与 STM32CubeMX 配合、HAL 库工程结构解析、时钟树配置与下载调试，最后点亮一颗 LED 验证整条链路。',
      published: true
    },
    {
      slug: 'gpio-and-exti-interrupts',
      title: '深入理解 GPIO 与外部中断机制',
      date: '2026-04-09',
      category: '底层原理',
      tags: ['STM32', '中断', '驱动开发'],
      excerpt: 'GPIO 的八种工作模式到底怎么选？上拉下拉电阻什么时候必须加？中断从引脚触发到执行 ISR 中间经历了什么？本文从硬件电路讲到 NVIC 优先级分组，把中断这条链路彻底打通。',
      published: true
    },
    {
      slug: 'uart-i2c-spi',
      title: '串口、I2C、SPI 三大总线对比与实战',
      date: '2026-05-16',
      category: '通信协议',
      tags: ['通信协议', 'STM32', '驱动开发'],
      excerpt: 'UART、I2C、SPI 是嵌入式最常用的三种板级通信方式。本文对比它们的时序、速率、引脚开销和适用场景，并给出裸机与 HAL 库两套驱动代码，外加逻辑分析仪抓包排错的方法。',
      published: true
    },
    {
      slug: 'freertos-task-scheduling',
      title: 'FreeRTOS 任务调度与优先级实战',
      date: '2026-06-21',
      category: '操作系统',
      tags: ['FreeRTOS', '中断', '驱动开发'],
      excerpt: '从裸机大循环跨到 RTOS，最容易踩的就是优先级和栈。本文讲透 FreeRTOS 的抢占式调度、任务状态迁移、优先级翻转与优先级继承，以及栈溢出和水位线检测的实用技巧。',
      published: true
    },
    {
      slug: 'esp32-wifi-mqtt',
      title: 'ESP32 实战：WiFi 温湿度监控上云',
      date: '2026-07-14',
      category: '项目实战',
      tags: ['ESP32', '物联网', '项目实战'],
      excerpt: '完整走一遍物联网项目流程：ESP32 驱动 DHT22 采集温湿度，通过 MQTT 上报到 EMQX 平台，再用手机端订阅显示。含 ESP-IDF 工程结构、WiFi 配网、断线重连与低功耗优化。',
      published: true
    },
    {
      slug: 'pcb-design-and-debug',
      title: 'PCB 设计入门与常见调试坑',
      date: '2026-08-10',
      category: '硬件设计',
      tags: ['PCB设计', '调试', '驱动开发'],
      excerpt: '硬件是软件的舞台。本文梳理 PCB 设计的基本流程与布线规则，重点讲电源完整性、地平面处理、晶振布局这些新手最常出问题的地方，以及板子回来不工作时该怎么一步步排查。',
      published: true
    },
    {
      slug: 'embedded-linux-cross-compile',
      title: '嵌入式 Linux 交叉编译与系统启动',
      date: '2026-09-06',
      category: '系统开发',
      tags: ['嵌入式Linux', '驱动开发'],
      excerpt: '从交叉编译工具链的搭建讲起，串起 U-Boot 移植、Linux 内核裁剪、设备树编写与根文件系统构建，最后完整梳理从上电到进入 shell 的启动流程，理解每一环到底发生了什么。',
      published: true
    },
    {
      slug: 'debugging-tools',
      title: '嵌入式调试利器：JTAG、逻辑分析仪与示波器',
      date: '2026-09-28',
      category: '调试技巧',
      tags: ['调试', 'STM32', 'PCB设计'],
      excerpt: '不会调试就等于不会开发。本文对比调试器、逻辑分析仪、示波器各自的适用场景与预算区间，并分享几个真实案例：怎么用它们定位死机、时序错乱和电源纹波问题。',
      published: true
    }
  ]
};
