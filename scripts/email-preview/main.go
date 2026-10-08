// Rend les gabarits supabase/templates/*.html exactement comme Supabase Auth (Go html/template,
// mêmes variables), avec des données d'exemple, pour vérifier qu'ils compilent et les prévisualiser
// dans chaque langue. Le modèle choisit la langue avec {{ .Data.lang }} (user_metadata.lang) :
// on vérifie aussi qu'un compte sans langue, avec une langue inconnue ou sans métadonnées du tout
// reçoit l'email dans la langue par défaut.
// Usage : go run scripts/email-preview/main.go <dossier de sortie>   (voir scripts/email-previews.sh)
// Sortie : <dossier>/<langue>-<modèle>.html, et une ligne « langue  modèle  objet » par rendu.
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

// Variante où .Data est une interface nil (métadonnées absentes)
type dataAny struct {
	SiteURL, ConfirmationURL, Token, TokenHash, RedirectTo, Email, NewEmail, OldEmail string
	Data                                                                              any
}

func render(t *template.Template, d any) string {
	var b strings.Builder
	if err := t.Execute(&b, d); err != nil {
		fmt.Fprintf(os.Stderr, "%s : rendu impossible : %v\n", t.Name(), err)
		os.Exit(1)
	}
	return b.String()
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: go run ./scripts/email-preview <dossier>")
		os.Exit(2)
	}
	out := os.Args[1]
	must(os.MkdirAll(out, 0o755))
	var brand struct {
		BaseUrl string `json:"baseUrl"`
	}
	raw, err := os.ReadFile("brand.config.json")
	must(err)
	must(json.Unmarshal(raw, &brand))
	var subjects map[string]json.RawMessage
	raw, err = os.ReadFile("supabase/templates/subjects.json")
	must(err)
	must(json.Unmarshal(raw, &subjects))
	var langs []string
	var def string
	must(json.Unmarshal(subjects["languages"], &langs))
	must(json.Unmarshal(subjects["defaultLanguage"], &def))
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
		var subj struct {
			Subject            string `json:"subject"`
			SubjectConditional string `json:"subjectConditional"`
		}
		must(json.Unmarshal(subjects[name], &subj))
		st, err := template.New("s").Parse(subj.Subject)
		must(err)
		sc, err := template.New("sc").Parse(subj.SubjectConditional)
		must(err)
		base := data{
			SiteURL: brand.BaseUrl, RedirectTo: brand.BaseUrl + "/", Token: "482913",
			TokenHash: "pkce_3f9a1c7e2b8d4f6a0c5e9b1d7a3f8c2e", Email: "camille@exemple.fr",
			NewEmail: "camille.nouvelle@exemple.fr", OldEmail: "camille.ancienne@exemple.fr",
			ConfirmationURL: brand.BaseUrl + "/auth/v1/verify?token=…",
		}
		if name == "email_changed_notification" {
			base.Email = "camille.nouvelle@exemple.fr"
		}
		rendered := map[string]string{}
		for _, l := range langs {
			d := base
			d.Data = map[string]any{"lang": l}
			html := render(t, d)
			if !strings.Contains(html, `<html lang="`+l+`"`) {
				fmt.Fprintf(os.Stderr, "%s : la langue %s ne donne pas un email en %s\n", f, l, l)
				os.Exit(1)
			}
			rendered[l] = html
			must(os.WriteFile(filepath.Join(out, l+"-"+name+".html"), []byte(html), 0o644))
			fmt.Printf("%s\t%s\t%s\t(objet si conditionnel : %s)\n", l, name, render(st, d), render(sc, d))
		}
		// Comptes sans langue (existants), langue inconnue, métadonnées absentes : langue par défaut
		cases := map[string]any{}
		d1 := base
		d1.Data = map[string]any{}
		cases["métadonnées vides"] = d1
		d2 := base
		d2.Data = nil
		cases["métadonnées nil (map)"] = d2
		d3 := base
		d3.Data = map[string]any{"lang": "de", "other": 1}
		cases["langue inconnue"] = d3
		d4 := base
		d4.Data = map[string]any{"lang": nil}
		cases["langue nulle"] = d4
		cases["métadonnées absentes (interface nil)"] = dataAny{SiteURL: base.SiteURL, RedirectTo: base.RedirectTo, Token: base.Token,
			TokenHash: base.TokenHash, Email: base.Email, NewEmail: base.NewEmail, OldEmail: base.OldEmail, ConfirmationURL: base.ConfirmationURL}
		for label, d := range cases {
			if render(t, d) != rendered[def] {
				fmt.Fprintf(os.Stderr, "%s : %s ne donne pas l'email en langue par défaut (%s)\n", f, label, def)
				os.Exit(1)
			}
		}
	}
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
