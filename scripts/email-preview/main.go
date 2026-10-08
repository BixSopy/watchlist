// Rend les gabarits supabase/templates/*.html exactement comme Supabase Auth (Go html/template,
// mêmes variables), avec des données d'exemple, pour vérifier qu'ils compilent et les prévisualiser.
// Usage : go run scripts/email-preview/main.go <dossier de sortie>   (voir scripts/email-previews.sh)
package main

import (
	"encoding/json"
	"fmt"
	"html/template"
	"os"
	"path/filepath"
	"strings"
)

type data struct {
	SiteURL, ConfirmationURL, Token, TokenHash, RedirectTo, Email, NewEmail, OldEmail string
	Data                                                                              map[string]any
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: go run ./scripts/email-preview <dossier>")
		os.Exit(2)
	}
	out := os.Args[1]
	must(os.MkdirAll(out, 0o755))
	var brand struct{ BaseUrl string `json:"baseUrl"` }
	raw, err := os.ReadFile("brand.config.json")
	must(err)
	must(json.Unmarshal(raw, &brand))
	var subjects map[string]json.RawMessage
	raw, err = os.ReadFile("supabase/templates/subjects.json")
	must(err)
	must(json.Unmarshal(raw, &subjects))
	files, _ := filepath.Glob("supabase/templates/*.html")
	for _, f := range files {
		name := strings.TrimSuffix(filepath.Base(f), ".html")
		src, err := os.ReadFile(f)
		must(err)
		t, err := template.New(name).Parse(string(src))
		if err != nil {
			fmt.Fprintf(os.Stderr, "%s : gabarit invalide : %v\n", f, err)
			os.Exit(1)
		}
		d := data{
			SiteURL: brand.BaseUrl, RedirectTo: brand.BaseUrl + "/", Token: "482913",
			TokenHash: "pkce_3f9a1c7e2b8d4f6a0c5e9b1d7a3f8c2e", Email: "camille@exemple.fr",
			NewEmail: "camille.nouvelle@exemple.fr", OldEmail: "camille.ancienne@exemple.fr",
			ConfirmationURL: brand.BaseUrl + "/auth/v1/verify?token=…", Data: map[string]any{},
		}
		if name == "email_changed_notification" {
			d.Email = "camille.nouvelle@exemple.fr"
		}
		var b strings.Builder
		if err := t.Execute(&b, d); err != nil {
			fmt.Fprintf(os.Stderr, "%s : rendu impossible : %v\n", f, err)
			os.Exit(1)
		}
		var subj struct{ Subject string `json:"subject"` }
		_ = json.Unmarshal(subjects[name], &subj)
		st, err := template.New("s").Parse(subj.Subject)
		must(err)
		var sb strings.Builder
		must(st.Execute(&sb, d))
		must(os.WriteFile(filepath.Join(out, name+".html"), []byte(b.String()), 0o644))
		fmt.Printf("%s\t%s\n", name, sb.String())
	}
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
