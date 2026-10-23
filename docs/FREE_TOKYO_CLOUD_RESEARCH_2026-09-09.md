# Free Tokyo cloud hosting: evidence and constraints

Checked: 2026-09-09 (Asia/Tokyo). Read-only public-source research; no account access, registration, provisioning, payment changes, or credential inspection occurred.

## Decision

**No researched provider is a verified solution for all four requirements together: zero user action now, indefinitely free operation, a persistent remote browser, and a genuinely fixed Tokyo egress IP.** This is the research conclusion from the enrollment, duration, location, and continuity constraints below, not a claim that every provider worldwide has been exhaustively checked.

OCI is the closest infrastructure candidate if the user later accepts account verification and uncertain Tokyo capacity. Its public documentation supports an ongoing free compute allowance and reserved public IPv4, but does not establish immediate availability or uninterrupted free hosting. [OCI Free Tier](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm), [OCI FAQ](https://www.oracle.com/cloud/free/faq/), [OCI public IPs](https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/managingpublicIPs.htm).

## Oracle Cloud Infrastructure

### Current allowance: resolve the 2/12 versus 4/24 conflict

- The current Always Free resource page specifies **1,500 OCPU-hours and 9,000 GB-hours/month**, equivalent to **2 OCPUs and 12 GB RAM** for an Always Free tenancy. It also includes 200 GB combined boot/block storage. The A1 processor is Arm. [Current Always Free documentation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).
- The price list separately states **paid tenancies** receive **3,000 OCPU-hours and 18,000 GB-hours/month** for A1, shared across the stated compute products. Thus quoting 4 OCPUs/24 GB for a new, non-upgraded free-only account is not supported by the current free-account documentation. Do not silently upgrade the user to obtain the paid-tenancy allowance. [Oracle price list, Ampere A1 footnote](https://www.oracle.com/cloud/price-list/).
- Oracle distinguishes ongoing Always Free resources from the **$300/30-day trial**. Its current trial-end instructions tell free users to stay within 2 OCPUs/12 GB total or risk A1 instances being disabled and deleted. [OCI Free Tier and trial expiry](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm).

### Tokyo and enrollment

- Tokyo exists as **Japan East (Tokyo), `ap-tokyo-1`**, with **one availability domain**. [OCI region list](https://docs.oracle.com/en-us/iaas/Content/General/Concepts/regions.htm).
- Always Free compute must be in the tenancy's home region. The home region cannot be changed after signup; the signup flow includes email/account creation, address and phone details, card verification, and accepting terms. [Signup procedure](https://docs.oracle.com/en-us/iaas/Content/GSG/Tasks/signingup_topic-Sign_Up_for_Free_Oracle_Cloud_Promotion.htm), [Always Free home-region restriction](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).
- Oracle requires accurate contact/billing details and uses eligible credit/debit cards for identity verification; virtual/prepaid/single-use cards are excluded. Available signup regions may differ from the general regional service list. A Tokyo region listing therefore does not prove Tokyo can be selected by this user today. [OCI FAQ](https://www.oracle.com/cloud/free/faq/).

### Fixed public IPv4, price evidence, and continuity

- A **reserved** public IPv4 persists beyond its instance and can be reassigned within its region. An **ephemeral** address is tied to its resource lifecycle and can be released on deletion/unassignment. A reserved Tokyo address is the appropriate infrastructure primitive for a stable IPv4 source when the browser uses that instance's direct Internet route. [OCI public IP documentation](https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/managingpublicIPs.htm), [VCN FAQ: public addressing and static NAT](https://www.oracle.com/cloud/networking/virtual-cloud-network/faq/).
- Oracle's official reserved-public-IP release announcement says the feature has no charge, and its VCN training PDF says even unassociated reserved public IPs are not charged. **Caveat:** these explicit price statements are older material; a current standalone IPv4 price line was not found in the current price list. The current persistent-IP behavior is documented, but this research did not inspect an account's present free-only reserved-IP quota or billing estimate. Do not promise a specific free-only quota or unconditional future pricing. [Official release announcement](https://blogs.oracle.com/cloud-infrastructure/release-announcement-reserved-public-ips-are-now-available-on-oracle-cloud-infrastructure), [Official VCN training](https://www.oracle.com/a/ocom/docs/cloud/virtual-cloud-network-100.pdf), [Current price list](https://www.oracle.com/cloud/price-list/).
- Oracle explicitly documents out-of-capacity errors. Idle Always Free instances may be reclaimed when the documented CPU, network and applicable memory thresholds remain below 20% over seven days. [Always Free capacity and reclaim rules](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).
- Free Tier has no SLA. Accounts idle for at least 30 days can be considered abandoned and suspended/terminated. **Inference:** an occasional browser workload cannot be sold as guaranteed unattended persistence, even if the disk and reserved address are configured correctly. [OCI FAQ](https://www.oracle.com/cloud/free/faq/).

## AWS

- The newer program launched in July 2025; the legacy 12-month model is not the default offer to assume for a newly created account. New customers receive $100 credits and may earn another $100 through specified activities. The free plan ends after six months or credit exhaustion, whichever comes first. Remaining credits on an upgraded paid plan still expire, so this is not permanent free EC2. [Launch announcement](https://aws.amazon.com/about-aws/whats-new/2025/07/aws-free-tier-credits-month-free-plan/), [Plan documentation](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html), [Credit expiry FAQ](https://aws.amazon.com/free/free-tier-faqs/).
- Tokyo EC2 is `ap-northeast-1`. An Elastic IP is a regional static IPv4 retained until released. Public IPv4 costs **US$0.005/address-hour**, in use or idle, before applicable credits/benefits. Tokyo capability and credit-funded use are not an ongoing free Tokyo bundle. [EC2 regions](https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-regions.html), [Elastic IP documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html), [VPC pricing](https://aws.amazon.com/vpc/pricing/).
- Signup requires personal details, a phone number and email; AWS says a credit card **may be required** for verification. Enrollment itself defeats zero-user-action eligibility for a user without an already-authorized account. [Signup requirements](https://aws.amazon.com/free/complete-signup/).

## Google Cloud

- The ongoing Compute Engine allowance is one non-preemptible `e2-micro`, exclusively in **`us-west1`, `us-central1`, or `us-east1`**, not Tokyo. The separate welcome trial is **$300 for 90 days**. A billing account and verified payment method are required; without upgrading, the trial closes and resources stop on expiry/exhaustion. [Google Free Program](https://docs.cloud.google.com/free/docs/free-cloud-features).
- Standard-VM external IPv4, static or ephemeral, costs **US$0.005/hour**, with only **one free hour/account/month** on the current table. Unused reserved IPv4 is **US$0.01/hour**. The page lists Tokyo as `asia-northeast1`. IPv6 has different pricing, but does not turn Tokyo compute into a free VM offer. [Network and external-IP pricing](https://cloud.google.com/vpc/network-pricing).
- **Conclusion:** the permanent compute allowance fails Tokyo location; the Tokyo trial fails duration and zero-action requirements. [Google Free Program](https://docs.cloud.google.com/free/docs/free-cloud-features).

## Microsoft Azure

- Azure's account page offers **$200 for 30 days** and eligible VM quantities for **12 months**, currently listing 750 hours each of B1s, B2pts v2 and B2ats v2. It requires a phone number, an eligible non-prepaid card and a Microsoft/GitHub account. Continuing after the initial credit period requires opting into pay-as-you-go. [Azure account and signup FAQ](https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account).
- Japan East is **Tokyo/Saitama**, not an exact Tokyo-city placement guarantee. Eligible free resources can be created where their service/SKU is available, but no account-specific availability or capacity was tested. [Azure region list](https://learn.microsoft.com/en-us/azure/reliability/regions-list), [Creating free services](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/create-free-services).
- ARM static public IPs are separately charged even when the associated VM is deallocated. The fetched price table contained currency placeholders, so **no numeric Azure IP price is asserted here**. [Public IP pricing](https://azure.microsoft.com/en-us/pricing/details/ip-addresses/).
- VM free quantities expire; later ongoing VM use is billed. **Conclusion:** Azure does not supply indefinite free Tokyo browser hosting and still requires enrollment/verification. [Free account expiry rules](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/avoid-charges-free-account).

## Other investigated offers

- **Sakura VPS:** two-week trial when selecting credit-card payment, not an ongoing free VM. [Sakura VPS](https://vps.sakura.ad.jp/).
- **Akamai/Linode:** the official Japan-language promotion found offers $100 valid for 60 days to new customers, not permanent free hosting. [Official promotion](https://www.akamai.com/ja/lp/linodetube).
- **Vultr:** a 2023 free-VM announcement was early access requiring a request and prioritized business-email accounts. Its newer signup guide describes trial credits lasting up to 30 days plus email/payment verification. **Unconfirmed:** current admission to that old free tier and any free Tokyo allocation. The old announcement is not evidence of zero-action free Tokyo availability today. [2023 announcement](https://blogs.vultr.com/new-free-tier-plan), [Current signup guide](https://docs.vultr.com/platform/create-an-account).
- **Alibaba Cloud:** official ECS documentation advertises a three-month trial for eligible new users; trial rules require a supported payment method. Tokyo is a listed region, but no current Tokyo trial inventory was verified. [ECS trial prerequisite](https://www.alibabacloud.com/help/en/ecs/user-guide/quickly-purchase-a-windows-instance-and-build-an-iis-service), [Trial eligibility/payment rules](https://www.alibabacloud.com/help/en/user-center/product-overview/learn-about-free-trials), [Tokyo region](https://www.alibabacloud.com/help/tc/egs/regions-and-zones-1).

## Boundaries and unresolved checks

This research establishes infrastructure offer constraints, not successful browser deployment. No source checked promises Xiaohongshu/Douyin login longevity, CAPTCHA exemption, or how those platforms label a cloud address geographically. A reserved cloud IP is not a residential-IP guarantee. These are separate acceptance tests, not implied benefits of the pricing pages.

No region was provisioned and no login was attempted. Actual account eligibility, Tokyo stock, free reserved-IP quota, Arm browser/container compatibility, browser profile persistence, and the destination platforms' behavior remain untested. Consequently the honest present answer is **no verified zero-action, permanent-free, fixed-Tokyo solution**, with OCI only a conditional future candidate.
