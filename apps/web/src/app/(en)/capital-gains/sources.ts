import type { Messages } from "@/messages/en";

type Words = Messages["capitalGains"]["sources"];
type Link = { label: keyof Words["documents"]; href: string };
type Source = { rule: keyof Words["rules"]; links: Link[] };

const BILL_2018: Link = {
  label: "bill2018",
  href: "https://www.indiabudget.gov.in/budget2018-2019/ub2018-19/fb/bill.pdf",
};
const BILL_2024: Link = {
  label: "bill2024",
  href: "https://www.indiabudget.gov.in/budget2024-25/doc/Finance_Bill.pdf",
};
const MEMO_2024: Link = {
  label: "memo2024",
  href: "https://www.indiabudget.gov.in/budget2024-25/doc/memo.pdf",
};
const FAQ_2024: Link = {
  label: "faq2024",
  href: "https://pib.gov.in/PressReleasePage.aspx?PRID=2036604",
};
const ACT_2025: Link = {
  label: "act2025",
  href: "https://egazette.gov.in/WriteReadData/2025/265620.pdf",
};

export const SOURCES: Source[] = [
  {
    rule: "holding",
    links: [
      BILL_2024,
      FAQ_2024,
      {
        label: "ramola",
        href: "https://delhihighcourt.nic.in/app/downloadOrderbByDate/ITA/1234/2011/12-04-2012",
      },
    ],
  },
  { rule: "s111A", links: [BILL_2024, MEMO_2024] },
  { rule: "s112A", links: [BILL_2018, BILL_2024, FAQ_2024] },
  { rule: "grandfathering", links: [BILL_2018] },
  {
    rule: "s112",
    links: [
      BILL_2024,
      MEMO_2024,
      { label: "cii", href: "https://incometaxindia.gov.in/w/view-all-cii" },
    ],
  },
  { rule: "s50AA", links: [BILL_2024, MEMO_2024] },
  { rule: "equityOriented", links: [BILL_2018] },
  { rule: "setOff", links: [ACT_2025] },
  { rule: "cess", links: [BILL_2018] },
  { rule: "act2025", links: [ACT_2025] },
];
